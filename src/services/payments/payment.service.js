import { prisma } from '../../config/prisma.js';
import { grantTools, grantWindow, isGrantActive, renewalBase, summarizeAccess } from '../../domain/access.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/httpError.js';
import { num, round2 } from '../../utils/money.js';
import { loadGrants } from '../access.service.js';
import { actorOf, GATEWAY, notifyEvent, recordEvent } from '../adminEvent.service.js';
import { createGiftCodes, emailGiftCodes } from '../gift.service.js';
import { promoPrice, usablePromotion } from '../promotion.service.js';
import { grantCredits } from '../credit.service.js';
import { sendClientEmail } from '../email.service.js';
import { assertCanBuyMasterclass } from '../masterclass.service.js';
import { activeProvider, mercadoPagoProvider, providerByCode } from './providers.js';

export const MAX_GIFTS = 20;
const SERVICE_TYPES = ['CONSULTA', 'ORIENTACION'];

const attemptView = (a) => ({
  id: a.id,
  status: a.status,
  provider: a.provider,
  amount: a.amount === null ? null : Number(a.amount),
  currency: a.currency,
  createdAt: a.createdAt,
  resolvedAt: a.resolvedAt,
  kind: a.kind,
  quantity: a.quantity,
  authorization: a.authorization || null,
  chargedAmount: a.chargedAmount === null || a.chargedAmount === undefined ? null : Number(a.chargedAmount),
  chargedCurrency: a.chargedCurrency || null,
  offer: a.offer ? { code: a.offer.code, name: a.offer.name, type: a.offer.type, moduleNumber: a.offer.moduleNumber, sessions: a.offer.sessions } : undefined,
});

async function checkoutData(user, { offerCode, promoCode, gift, quantity: wanted }) {
  if (promoCode) {
    const promo = await usablePromotion(user.id, promoCode);
    if (promo.offer.price === null) throw conflict('Este producto todavía no tiene precio definido');
    return { offer: promo.offer, kind: 'PROMO', amount: promoPrice(promo.offer, promo.discountPercent), promotionId: promo.id, quantity: 1 };
  }
  const offer = await prisma.productOffer.findUnique({ where: { code: offerCode } });
  if (!offer || !offer.active) throw notFound('Esta opción de acceso no está disponible');
  if (gift) {
    if (!offer.giftable) throw badRequest('Este producto no está disponible para regalo');
    const quantity = Math.min(MAX_GIFTS, Math.max(1, Number(gift.quantity) || 1));
    return {
      offer, kind: 'GIFT', quantity,
      amount: offer.price === null ? null : round2(num(offer.price) * quantity),
      giftMessage: gift.message ? String(gift.message).slice(0, 500) : null,
      giftRecipientName: gift.recipientName ? String(gift.recipientName).slice(0, 120) : null,
    };
  }
  const access = summarizeAccess(await loadGrants(user.id));
  const permanentTool = grantTools(offer).every((n) => access.toolAccess.some((t) => t.moduleNumber === n && !t.expiresAt));
  if (offer.type === 'TOOL_ONLY' && (access.full || permanentTool)) throw conflict('Ya tienes acceso a las herramientas');
  if (offer.type === 'MASTERCLASS') await assertCanBuyMasterclass(user.id, offer, access);
  if (offer.type === 'CONSULTA' && !access.hasAny) throw conflict('Las consultas se envían desde Ejercicio y avance de cada módulo. Necesitas Herramientas o una membresía activa para usarlas.');
  if (SERVICE_TYPES.includes(offer.type)) {
    const quantity = Math.min(MAX_GIFTS, Math.max(1, Number(wanted) || 1));
    return { offer, kind: 'STANDARD', amount: offer.price === null ? null : round2(num(offer.price) * quantity), quantity };
  }
  return { offer, kind: 'STANDARD', amount: offer.price, quantity: 1 };
}

export async function createCheckout(user, input) {
  const params = typeof input === 'string' ? { offerCode: input } : input;
  const data = await checkoutData(user, params);
  const provider = await activeProvider();
  const charge = await provider.quote(data.amount, data.offer.currency);
  const attempt = await prisma.paymentAttempt.create({
    data: {
      userId: user.id, offerId: data.offer.id, amount: data.amount, currency: data.offer.currency, provider: provider.code,
      chargedAmount: charge?.amount ?? null, chargedCurrency: charge?.currency ?? null,
      kind: data.kind, quantity: data.quantity, promotionId: data.promotionId || null, giftMessage: data.giftMessage || null, giftRecipientName: data.giftRecipientName || null,
    },
    include: { offer: true },
  });
  let checkout;
  try {
    checkout = await provider.createCheckout({ attempt, offer: data.offer, user, charge });
  } catch (err) {
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'REJECTED', resolvedAt: new Date() } });
    throw err;
  }
  if (checkout.providerRef) await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { providerRef: checkout.providerRef } });
  if (data.kind === 'STANDARD') {
    await recordEvent({ category: 'SUSCRIPCION', type: 'CONTRATADA', actor: actorOf(user), user, offer: data.offer, status: 'Pago pendiente', amount: data.amount });
  }
  return { attempt: attemptView(attempt), checkout: { mode: checkout.mode, publicKey: checkout.publicKey || null } };
}

async function subscriptionEventType(tx, attempt) {
  const all = await tx.accessGrant.findMany({ where: { userId: attempt.userId } });
  const user = await tx.user.findUnique({ where: { id: attempt.userId }, select: { subscriptionCancelledAt: true } });
  const sameType = all.filter((g) => g.active && g.accessType === attempt.offer.type && isGrantActive(g));
  if (sameType.length && !user.subscriptionCancelledAt) return 'RENOVADA';
  if (all.length) return 'RECUPERADA';
  return 'ACTIVADA';
}

const canRecover = (attempt, status) => status === 'APPROVED' && attempt.status === 'REJECTED' && attempt.provider === 'MERCADOPAGO';

export async function resolveAttempt(attemptId, status, db = prisma, { paidAmount, paidCurrency, paymentId } = {}) {
  const result = await db.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUnique({ where: { id: attemptId }, include: { offer: true, user: true, promotion: true } });
    if (!attempt) throw notFound('Intento de pago no encontrado');
    if (attempt.status !== 'PENDING' && !canRecover(attempt, status)) return { attempt: attemptView(attempt), changed: false };
    const expected = attempt.chargedAmount ?? attempt.amount;
    const wrongCurrency = status === 'APPROVED' && paidCurrency && attempt.chargedCurrency && paidCurrency !== attempt.chargedCurrency;
    if (status === 'APPROVED' && ((paidAmount !== undefined && paidAmount !== null && expected !== null && Math.abs(num(paidAmount) - num(expected)) > 0.01) || wrongCurrency)) {
      const event = await recordEvent({ category: 'SUSCRIPCION', type: 'IMPORTE_NO_COINCIDE', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: 'Sin activar', amount: paidAmount, result: `Se esperaba ${num(expected)}${attempt.chargedCurrency ? ` ${attempt.chargedCurrency}` : ''}; el acceso no se activó` }, tx);
      return { attempt: attemptView(attempt), changed: false, events: [event] };
    }
    const updated = await tx.paymentAttempt.updateMany({ where: { id: attemptId, status: attempt.status }, data: { status, resolvedAt: new Date(), ...(paymentId ? { providerPaymentId: String(paymentId) } : {}) } });
    if (!updated.count) return { attempt: attemptView(attempt), changed: false };
    const events = [];
    let gifts = null;
    let mail = null;
    if (status === 'REJECTED') {
      if (attempt.kind === 'PROMO') await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { promotionId: null } });
      events.push(await recordEvent({ category: 'SUSCRIPCION', type: 'PAGO_FALLIDO', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: 'Rechazado', amount: attempt.amount, result: attempt.kind === 'GIFT' ? 'Compra de regalo' : attempt.kind === 'PROMO' ? 'Pago promocional' : null }, tx));
    } else if (attempt.kind === 'PROMO') {
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { authorization: 'PENDING' } });
      if (attempt.promotionId) await tx.promotion.update({ where: { id: attempt.promotionId }, data: { status: 'USADA', usedAt: new Date() } });
      events.push(await recordEvent({
        category: 'PROMOCION', type: 'PAGO_PROMOCIONAL', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: 'Pendiente de autorización', amount: attempt.amount,
        result: `Confirmado · ${attempt.promotion ? `${attempt.promotion.discountPercent}% · código ${attempt.promotion.code}` : 'promoción'} · requiere autorización del Administrador General`,
      }, tx));
    } else if (attempt.kind === 'GIFT') {
      gifts = await createGiftCodes(tx, attempt);
      events.push(await recordEvent({ category: 'REGALO', type: 'REGALO_COMPRADO', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: `${attempt.quantity} código(s) disponible(s)`, amount: attempt.amount, result: gifts.codes.join(', ') }, tx));
    } else {
      if (SERVICE_TYPES.includes(attempt.offer.type)) {
        await grantCredits(tx, { userId: attempt.userId, kind: attempt.offer.type, quantity: attempt.quantity, source: 'PAGO', paymentAttemptId: attempt.id });
        events.push(await recordEvent({ category: 'SUSCRIPCION', type: 'SERVICIO_COMPRADO', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: `${attempt.quantity} disponible(s)`, amount: attempt.amount }, tx));
        return { attempt: attemptView({ ...attempt, status, resolvedAt: new Date() }), changed: true, events, offer: attempt.offer, userId: attempt.userId, mail: ['SERVICIO_DISPONIBLE', 'serviceCredits', attempt.user, { name: attempt.user.name, product: attempt.offer.name, quantity: attempt.quantity }] };
      }
      const type = await subscriptionEventType(tx, attempt);
      const grants = await tx.accessGrant.findMany({ where: { userId: attempt.userId, active: true } });
      const { startsAt, expiresAt } = grantWindow(attempt.offer, renewalBase(grants, attempt.offer));
      const grant = await tx.accessGrant.create({
        data: { userId: attempt.userId, offerId: attempt.offerId, paymentAttemptId: attempt.id, accessType: attempt.offer.type, moduleNumber: attempt.offer.moduleNumber, startsAt, expiresAt, source: 'PAGO' },
      });
      if (attempt.offer.sessions > 0) await grantCredits(tx, { userId: attempt.userId, kind: 'ORIENTACION', quantity: attempt.offer.sessions, source: 'MEMBRESIA', grantId: grant.id, paymentAttemptId: attempt.id, expiresAt });
      await tx.user.update({ where: { id: attempt.userId }, data: { retentionStage: 0 } });
      await tx.user.update({ where: { id: attempt.userId }, data: { subscriptionCancelledAt: null } });
      events.push(await recordEvent({ category: 'SUSCRIPCION', type, actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: 'Activo', amount: attempt.amount, result: `Vigente hasta ${expiresAt.toISOString().slice(0, 10)}` }, tx));
      mail = ['ACCESO_ACTIVADO', 'accessActivated', attempt.user, { name: attempt.user.name, product: attempt.offer.name, expiresAt }];
    }
    return { attempt: attemptView({ ...attempt, status, resolvedAt: new Date(), authorization: attempt.kind === 'PROMO' && status === 'APPROVED' ? 'PENDING' : attempt.authorization }), changed: true, events, gifts, mail, offer: attempt.offer, userId: attempt.userId };
  });
  for (const event of result.events || []) notifyEvent(event);
  if (result.mail) sendClientEmail(result.mail[0], result.mail[1], result.mail[2].email, result.mail[3]).catch(() => null);
  if (result.gifts) await emailGiftCodes(result.userId, result.offer, result.gifts.codes, result.gifts.redeemBy).catch(() => null);
  return { attempt: result.attempt, changed: result.changed, gifts: result.gifts ? result.gifts.codes : undefined };
}

export async function resolveSimulated(user, attemptId, outcome) {
  const attempt = await prisma.paymentAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.userId !== user.id) throw notFound('Intento de pago no encontrado');
  if (!providerByCode(attempt.provider)?.supportsManualResolution || !(await activeProvider()).supportsManualResolution) throw forbidden('Este pago solo puede confirmarlo el proveedor');
  if (attempt.status !== 'PENDING') throw badRequest('Este intento ya fue resuelto');
  return resolveAttempt(attemptId, outcome);
}

export async function syncAttempt(user, attemptId, { search = (id) => mercadoPagoProvider.searchByAttempt(id) } = {}) {
  let attempt = await prisma.paymentAttempt.findUnique({ where: { id: attemptId }, include: { offer: true } });
  if (!attempt || attempt.userId !== user.id) throw notFound('Intento de pago no encontrado');
  if (attempt.provider === 'MERCADOPAGO' && attempt.status !== 'APPROVED') {
    const payments = await search(attempt.id);
    const best = payments.find((p) => p.status === 'APPROVED') || (payments.length && payments.every((p) => p.status === 'REJECTED') ? payments[0] : null);
    if (best) {
      await resolveAttempt(attempt.id, best.status, prisma, { paidAmount: best.amount, paidCurrency: best.currency, paymentId: best.paymentId });
      attempt = await prisma.paymentAttempt.findUnique({ where: { id: attemptId }, include: { offer: true } });
    }
  }
  const gifts = attempt.kind === 'GIFT' && attempt.status === 'APPROVED'
    ? (await prisma.giftCode.findMany({ where: { paymentAttemptId: attempt.id }, select: { code: true } })).map((g) => g.code)
    : undefined;
  return { attempt: attemptView(attempt), gifts };
}

const NO_SEARCH = { search: async () => [] };

export async function payWithCard(user, attemptId, card) {
  const attempt = await prisma.paymentAttempt.findUnique({ where: { id: attemptId }, include: { offer: true } });
  if (!attempt || attempt.userId !== user.id) throw notFound('Intento de pago no encontrado');
  if (attempt.provider !== 'MERCADOPAGO') throw forbidden('Este pago no se procesa con tarjeta');
  const claimed = await prisma.paymentAttempt.updateMany({ where: { id: attempt.id, status: 'PENDING', providerRef: null }, data: { providerRef: attempt.id } });
  if (!claimed.count) throw conflict('Este pago ya se está procesando. Revisa tu historial en Mi acceso.');
  let payment;
  try {
    payment = await mercadoPagoProvider.chargeCard({ attempt, offer: attempt.offer, user, card });
  } catch (err) {
    if (err.providerStatus >= 400 && err.providerStatus < 500) {
      await resolveAttempt(attempt.id, 'REJECTED');
      return { ...(await syncAttempt(user, attempt.id, NO_SEARCH)), reason: 'cc_rejected_other_reason' };
    }
    console.error('[pagos] cobro sin confirmar:', attempt.id, err.message);
    return syncAttempt(user, attempt.id).catch(() => syncAttempt(user, attempt.id, NO_SEARCH));
  }
  if (payment.status === 'PENDING') await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { providerPaymentId: payment.paymentId } });
  else await resolveAttempt(attempt.id, payment.status, prisma, { paidAmount: payment.amount, paidCurrency: payment.currency, paymentId: payment.paymentId });
  return { ...(await syncAttempt(user, attempt.id, NO_SEARCH)), reason: payment.statusDetail, challenge: payment.challenge };
}

export const listMyAttempts = async (userId) =>
  (await prisma.paymentAttempt.findMany({ where: { userId }, include: { offer: true }, orderBy: { createdAt: 'desc' }, take: 50 })).map(attemptView);

export const listAllAttempts = async ({ status } = {}) =>
  (await prisma.paymentAttempt.findMany({
    where: status ? { status } : {},
    include: { offer: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })).map((a) => ({ ...attemptView(a), user: a.user }));

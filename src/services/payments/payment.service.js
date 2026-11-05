import { prisma } from '../../config/prisma.js';
import { grantTools, grantWindow, isGrantActive, renewalBase, summarizeAccess } from '../../domain/access.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/httpError.js';
import { num, round2 } from '../../utils/money.js';
import { loadGrants } from '../access.service.js';
import { actorOf, GATEWAY, notifyEvent, recordEvent } from '../adminEvent.service.js';
import { createGiftCodes, emailGiftCodes } from '../gift.service.js';
import { promoPrice, usablePromotion } from '../promotion.service.js';
import { grantCredits } from '../credit.service.js';
import { assertCanBuyMasterclass } from '../masterclass.service.js';
import { activeProvider, providerByCode } from './providers.js';

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
  offer: a.offer ? { code: a.offer.code, name: a.offer.name, type: a.offer.type, moduleNumber: a.offer.moduleNumber } : undefined,
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
  if (SERVICE_TYPES.includes(offer.type)) {
    const quantity = Math.min(MAX_GIFTS, Math.max(1, Number(wanted) || 1));
    return { offer, kind: 'STANDARD', amount: offer.price === null ? null : round2(num(offer.price) * quantity), quantity };
  }
  return { offer, kind: 'STANDARD', amount: offer.price, quantity: 1 };
}

export async function createCheckout(user, input) {
  const params = typeof input === 'string' ? { offerCode: input } : input;
  const data = await checkoutData(user, params);
  const provider = activeProvider();
  const attempt = await prisma.paymentAttempt.create({
    data: {
      userId: user.id, offerId: data.offer.id, amount: data.amount, currency: data.offer.currency, provider: provider.code,
      kind: data.kind, quantity: data.quantity, promotionId: data.promotionId || null, giftMessage: data.giftMessage || null, giftRecipientName: data.giftRecipientName || null,
    },
    include: { offer: true },
  });
  const checkout = await provider.createCheckout({ attempt, offer: data.offer, user });
  if (checkout.providerRef) await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { providerRef: checkout.providerRef } });
  if (data.kind === 'STANDARD') {
    await recordEvent({ category: 'SUSCRIPCION', type: 'CONTRATADA', actor: actorOf(user), user, offer: data.offer, status: 'Pago pendiente', amount: data.amount });
  }
  return { attempt: attemptView(attempt), checkout: { mode: checkout.mode, initPoint: checkout.initPoint || null } };
}

async function subscriptionEventType(tx, attempt) {
  const all = await tx.accessGrant.findMany({ where: { userId: attempt.userId } });
  const user = await tx.user.findUnique({ where: { id: attempt.userId }, select: { subscriptionCancelledAt: true } });
  const sameType = all.filter((g) => g.active && g.accessType === attempt.offer.type && isGrantActive(g));
  if (sameType.length && !user.subscriptionCancelledAt) return 'RENOVADA';
  if (all.length) return 'RECUPERADA';
  return 'ACTIVADA';
}

export async function resolveAttempt(attemptId, status, db = prisma, { paidAmount } = {}) {
  const result = await db.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUnique({ where: { id: attemptId }, include: { offer: true, user: true, promotion: true } });
    if (!attempt) throw notFound('Intento de pago no encontrado');
    if (attempt.status !== 'PENDING') return { attempt: attemptView(attempt), changed: false };
    if (status === 'APPROVED' && paidAmount !== undefined && paidAmount !== null && attempt.amount !== null && Math.abs(num(paidAmount) - num(attempt.amount)) > 0.01) {
      const event = await recordEvent({ category: 'SUSCRIPCION', type: 'IMPORTE_NO_COINCIDE', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: 'Sin activar', amount: paidAmount, result: `Se esperaba ${num(attempt.amount)}; el acceso no se activó` }, tx);
      return { attempt: attemptView(attempt), changed: false, events: [event] };
    }
    const updated = await tx.paymentAttempt.updateMany({ where: { id: attemptId, status: 'PENDING' }, data: { status, resolvedAt: new Date() } });
    if (!updated.count) return { attempt: attemptView(attempt), changed: false };
    const events = [];
    let gifts = null;
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
        return { attempt: attemptView({ ...attempt, status, resolvedAt: new Date() }), changed: true, events, offer: attempt.offer, userId: attempt.userId };
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
    }
    return { attempt: attemptView({ ...attempt, status, resolvedAt: new Date(), authorization: attempt.kind === 'PROMO' && status === 'APPROVED' ? 'PENDING' : attempt.authorization }), changed: true, events, gifts, offer: attempt.offer, userId: attempt.userId };
  });
  for (const event of result.events || []) notifyEvent(event);
  if (result.gifts) await emailGiftCodes(result.userId, result.offer, result.gifts.codes, result.gifts.redeemBy).catch(() => null);
  return { attempt: result.attempt, changed: result.changed, gifts: result.gifts ? result.gifts.codes : undefined };
}

export async function resolveSimulated(user, attemptId, outcome) {
  const attempt = await prisma.paymentAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.userId !== user.id) throw notFound('Intento de pago no encontrado');
  if (!providerByCode(attempt.provider)?.supportsManualResolution) throw forbidden('Este pago solo puede confirmarlo el proveedor');
  if (attempt.status !== 'PENDING') throw badRequest('Este intento ya fue resuelto');
  return resolveAttempt(attemptId, outcome);
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

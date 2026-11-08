import { prisma } from '../../config/prisma.js';
import { grantTools, grantWindow, isGrantActive, RECURRING_OFFER_TYPES, renewalBase, subscriptionWindow, summarizeAccess } from '../../domain/access.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/httpError.js';
import { num, round2 } from '../../utils/money.js';
import { loadGrants } from '../access.service.js';
import { GATEWAY, notifyEvent, recordEvent } from '../adminEvent.service.js';
import { createGiftCodes, emailGiftCodes } from '../gift.service.js';
import { promoPrice, usablePromotion } from '../promotion.service.js';
import { grantCredits } from '../credit.service.js';
import { sendClientEmail } from '../email.service.js';
import { assertCanBuyMasterclass } from '../masterclass.service.js';
import { activeProvider, anyGatewayEnabled, mercadoPagoProvider, paypalProvider, providerByCode } from './providers.js';

export const MAX_GIFTS = 20;
const NO_SEARCH = { search: async () => [] };
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
  billingCycle: a.billingCycle || null,
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

async function clearAbandonedSubscriptions(userId) {
  const pending = await prisma.subscription.findMany({ where: { userId, status: 'PENDING', provider: 'MERCADOPAGO' } });
  for (const sub of pending) {
    const remote = sub.providerSubscriptionId ? await mercadoPagoProvider.getSubscription(sub.providerSubscriptionId).catch(() => null) : null;
    if (remote?.status === 'authorized') {
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', nextBillingAt: remote.next_payment_date ? new Date(remote.next_payment_date) : sub.nextBillingAt } });
      continue;
    }
    if (remote) await mercadoPagoProvider.cancelSubscription(sub.providerSubscriptionId).catch(() => null);
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED', nextBillingAt: null } });
    await prisma.paymentAttempt.updateMany({ where: { subscriptionId: sub.id, status: 'PENDING' }, data: { status: 'REJECTED', resolvedAt: new Date() } });
  }
}

export async function createCheckout(user, input) {
  const params = typeof input === 'string' ? { offerCode: input } : input;
  const data = await checkoutData(user, params);
  const provider = await activeProvider(params.provider, user);
  const charge = await provider.quote(data.amount, data.offer.currency);
  const recurringOffer = provider.code !== 'MOCK' && data.kind === 'STANDARD' && RECURRING_OFFER_TYPES.includes(data.offer.type) ? data.offer.billingCycle || null : null;
  const billingCycle = provider.code === 'MERCADOPAGO' ? recurringOffer : null;
  if (recurringOffer) await clearAbandonedSubscriptions(user.id);
  if (recurringOffer && (await prisma.subscription.findFirst({ where: { userId: user.id, status: { in: ['ACTIVE', 'SUSPENDED'] } } }))) {
    throw conflict('Ya tienes una suscripción activa. Cancélala en Mi acceso para contratar otra.');
  }
  const attempt = await prisma.paymentAttempt.create({
    data: {
      userId: user.id, offerId: data.offer.id, amount: data.amount, currency: data.offer.currency, provider: provider.code,
      chargedAmount: charge?.amount ?? null, chargedCurrency: charge?.currency ?? null,
      kind: data.kind, quantity: data.quantity, billingCycle, promotionId: data.promotionId || null, giftMessage: data.giftMessage || null, giftRecipientName: data.giftRecipientName || null,
    },
    include: { offer: true },
  });
  let checkout;
  try {
    checkout = await provider.createCheckout({ attempt, offer: data.offer, user, charge });
  } catch (err) {
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'REJECTED', resolvedAt: new Date() } });
    if (err.providerDetail) {
      await recordEvent({ category: 'SUSCRIPCION', type: 'PAGO_FALLIDO', actor: GATEWAY, user, offer: data.offer, status: 'Mercado Pago no aceptó la solicitud', amount: data.amount, result: err.providerDetail });
      err.message = `${err.message}. Detalle para soporte: ${err.providerDetail}`;
    }
    throw err;
  }
  if (checkout.providerRef) await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { providerRef: checkout.providerRef } });
  if (checkout.subscription) {
    const sub = await prisma.subscription.create({
      data: { userId: user.id, offerId: data.offer.id, provider: provider.code, providerSubscriptionId: checkout.subscription.id, cycle: billingCycle, amount: attempt.chargedAmount, currency: attempt.chargedCurrency, status: checkout.subscription.status === 'authorized' ? 'ACTIVE' : 'PENDING', nextBillingAt: checkout.subscription.nextBillingAt ? new Date(checkout.subscription.nextBillingAt) : null },
    });
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { subscriptionId: sub.id } });
  }
  return { attempt: attemptView(attempt), checkout: { mode: checkout.mode, initPoint: checkout.initPoint || null, uid: checkout.uid || null, instructions: checkout.instructions || null, wallet: checkout.wallet || null } };
}

async function paidStatus(tx, attempt) {
  const all = await tx.accessGrant.findMany({ where: { userId: attempt.userId } });
  const user = await tx.user.findUnique({ where: { id: attempt.userId }, select: { subscriptionCancelledAt: true } });
  const sameType = all.filter((g) => g.active && g.accessType === attempt.offer.type && isGrantActive(g));
  if (sameType.length && !user.subscriptionCancelledAt) return 'Pago exitoso · renovación';
  if (all.length) return 'Pago exitoso · recuperación';
  return 'Pago exitoso · primera compra';
}

const canRecover = (attempt, status) => status === 'APPROVED' && attempt.status === 'REJECTED' && attempt.provider === 'MERCADOPAGO';

export async function resolveAttempt(attemptId, status, db = prisma, { paidAmount, paidCurrency, paymentId, failureDetail } = {}) {
  const result = await db.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUnique({ where: { id: attemptId }, include: { offer: true, user: true, promotion: true, subscription: true } });
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
      events.push(await recordEvent({ category: 'SUSCRIPCION', type: 'PAGO_FALLIDO', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: 'Rechazado', amount: attempt.amount, result: [attempt.kind === 'GIFT' ? 'Compra de regalo' : attempt.kind === 'PROMO' ? 'Pago promocional' : null, failureDetail].filter(Boolean).join(' · ') || null }, tx));
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
        events.push(await recordEvent({ category: 'SUSCRIPCION', type: 'PAGO_EXITOSO', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: 'Pago exitoso', amount: attempt.amount, result: `${attempt.quantity} disponible(s)` }, tx));
        return { attempt: attemptView({ ...attempt, status, resolvedAt: new Date() }), changed: true, events, offer: attempt.offer, userId: attempt.userId, mail: ['SERVICIO_DISPONIBLE', 'serviceCredits', attempt.user, { name: attempt.user.name, product: attempt.offer.name, quantity: attempt.quantity }] };
      }
      const paid = await paidStatus(tx, attempt);
      const grants = await tx.accessGrant.findMany({ where: { userId: attempt.userId, active: true } });
      const base = renewalBase(grants, attempt.offer);
      const { startsAt, expiresAt } = attempt.subscriptionId && attempt.billingCycle ? subscriptionWindow(attempt.billingCycle, base) : grantWindow(attempt.offer, base);
      const grant = await tx.accessGrant.create({
        data: { userId: attempt.userId, offerId: attempt.offerId, paymentAttemptId: attempt.id, accessType: attempt.offer.type, moduleNumber: attempt.offer.moduleNumber, startsAt, expiresAt, source: 'PAGO' },
      });
      if (attempt.offer.sessions > 0) await grantCredits(tx, { userId: attempt.userId, kind: 'ORIENTACION', quantity: attempt.offer.sessions, source: 'MEMBRESIA', grantId: grant.id, paymentAttemptId: attempt.id, expiresAt });
      await tx.user.update({ where: { id: attempt.userId }, data: { retentionStage: 0 } });
      if (attempt.subscription?.status !== 'CANCELLED') await tx.user.update({ where: { id: attempt.userId }, data: { subscriptionCancelledAt: null } });
      events.push(await recordEvent({ category: 'SUSCRIPCION', type: 'PAGO_EXITOSO', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: paid, amount: attempt.amount, result: `Vigente hasta ${expiresAt.toISOString().slice(0, 10)}` }, tx));
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
  if (!providerByCode(attempt.provider)?.supportsManualResolution || (await anyGatewayEnabled())) throw forbidden('Este pago solo puede confirmarlo el proveedor');
  if (attempt.status !== 'PENDING') throw badRequest('Este intento ya fue resuelto');
  return resolveAttempt(attemptId, outcome);
}

export async function closeSubscription(sub, status) {
  if (sub.status !== status) await prisma.subscription.update({ where: { id: sub.id }, data: { status, cancelledAt: sub.cancelledAt || new Date(), nextBillingAt: null } });
  const pending = await prisma.paymentAttempt.findMany({ where: { subscriptionId: sub.id, status: 'PENDING' }, select: { id: true } });
  for (const p of pending) await resolveAttempt(p.id, 'REJECTED');
  if (status === 'CANCELLED' && !sub.cancelledAt) {
    const user = await prisma.user.findUnique({ where: { id: sub.userId } });
    const offer = await prisma.productOffer.findUnique({ where: { id: sub.offerId } });
    await prisma.user.update({ where: { id: sub.userId }, data: { subscriptionCancelledAt: new Date() } });
    await recordEvent({ category: 'SUSCRIPCION', type: 'CANCELADA', actor: GATEWAY, user, offer, status: 'Cancelada en la pasarela de pago', amount: sub.amount });
  }
}

export async function recordReversal(paymentId, label) {
  const attempt = await prisma.paymentAttempt.findFirst({ where: { providerPaymentId: paymentId }, include: { user: true, offer: true } });
  if (attempt?.status !== 'APPROVED') return;
  await recordEvent({ category: 'SUSCRIPCION', type: 'PAGO_REVERTIDO', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: label, amount: attempt.amount, result: 'El acceso sigue activo: revísalo en Control de accesos' });
}

export async function applySubscriptionPayment(sub, { paymentId, amount, currency }) {
  if (await prisma.paymentAttempt.findFirst({ where: { providerPaymentId: paymentId, provider: sub.provider } })) return { duplicate: true };
  const attempts = await prisma.paymentAttempt.findMany({ where: { subscriptionId: sub.id }, orderBy: { createdAt: 'asc' } });
  let target = attempts.find((a) => a.status === 'PENDING');
  if (!target) {
    const first = attempts[0];
    try {
      target = await prisma.paymentAttempt.create({
        data: {
          userId: sub.userId, offerId: sub.offerId, provider: sub.provider, providerRef: `${sub.provider}:${paymentId}`, subscriptionId: sub.id, billingCycle: sub.cycle, kind: 'STANDARD', quantity: 1,
          amount: first?.amount ?? sub.amount, currency: first?.currency ?? sub.currency, chargedAmount: sub.amount, chargedCurrency: sub.currency,
        },
      });
    } catch (err) {
      if (err?.code === 'P2002') return { duplicate: true };
      throw err;
    }
  }
  const result = await resolveAttempt(target.id, 'APPROVED', prisma, { paidAmount: amount, paidCurrency: currency, paymentId });
  if (result.attempt.status === 'APPROVED') await prisma.subscription.update({ where: { id: sub.id }, data: { lastPaymentAt: new Date(), ...(sub.status === 'CANCELLED' ? {} : { status: 'ACTIVE' }) } });
  return result;
}

export async function refreshPaypalSubscription(sub) {
  const data = await paypalProvider.getSubscription(sub.providerSubscriptionId);
  const next = data.billing_info?.next_billing_time ? new Date(data.billing_info.next_billing_time) : sub.nextBillingAt;
  if (data.status === 'ACTIVE') {
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', nextBillingAt: next } });
    for (const sale of await paypalProvider.subscriptionSales(sub.providerSubscriptionId, sub.createdAt)) {
      await applySubscriptionPayment(sub, { paymentId: sale.paymentId, amount: sale.amount, currency: sale.currency });
    }
  } else if (['CANCELLED', 'EXPIRED'].includes(data.status)) {
    await closeSubscription(sub, data.status);
  }
}

export async function syncAttempt(user, attemptId, { search = (id) => mercadoPagoProvider.searchByAttempt(id) } = {}) {
  let attempt = await prisma.paymentAttempt.findUnique({ where: { id: attemptId }, include: { offer: true, subscription: true } });
  if (!attempt || attempt.userId !== user.id) throw notFound('Intento de pago no encontrado');
  if (search !== NO_SEARCH.search && attempt.status === 'PENDING' && attempt.subscription?.providerSubscriptionId) {
    if (attempt.provider === 'PAYPAL') await refreshPaypalSubscription(attempt.subscription).catch(() => null);
    else {
      const preapproval = await mercadoPagoProvider.getSubscription(attempt.subscription.providerSubscriptionId).catch(() => null);
      if (['canceled', 'cancelled'].includes(preapproval?.status)) await closeSubscription(attempt.subscription, 'CANCELLED');
      else if (preapproval?.status === 'authorized') await prisma.subscription.update({ where: { id: attempt.subscription.id }, data: { status: 'ACTIVE', nextBillingAt: preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : attempt.subscription.nextBillingAt } });
    }
    attempt = await prisma.paymentAttempt.findUnique({ where: { id: attemptId }, include: { offer: true, subscription: true } });
  } else if (attempt.provider === 'MERCADOPAGO' && attempt.status !== 'APPROVED' && !attempt.subscriptionId) {
    const payments = await search(attempt.id);
    const best = payments.find((p) => p.status === 'APPROVED') || (payments.length && payments.every((p) => p.status === 'REJECTED') ? payments[0] : null);
    if (best) {
      await resolveAttempt(attempt.id, best.status, prisma, { paidAmount: best.amount, paidCurrency: best.currency, paymentId: best.paymentId, failureDetail: best.status === 'REJECTED' && best.statusDetail ? `Mercado Pago: ${best.statusDetail}` : undefined });
      attempt = await prisma.paymentAttempt.findUnique({ where: { id: attemptId }, include: { offer: true } });
    }
  }
  const gifts = attempt.kind === 'GIFT' && attempt.status === 'APPROVED'
    ? (await prisma.giftCode.findMany({ where: { paymentAttemptId: attempt.id }, select: { code: true } })).map((g) => g.code)
    : undefined;
  return { attempt: attemptView(attempt), gifts };
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

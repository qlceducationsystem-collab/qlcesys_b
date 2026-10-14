import { prisma } from '../../config/prisma.js';
import { grantWindow, summarizeAccess } from '../../domain/access.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/httpError.js';
import { track } from '../analytics.service.js';
import { loadGrants } from '../access.service.js';
import { activeProvider, providerByCode } from './providers.js';

const attemptView = (a) => ({
  id: a.id,
  status: a.status,
  provider: a.provider,
  amount: a.amount === null ? null : Number(a.amount),
  currency: a.currency,
  createdAt: a.createdAt,
  resolvedAt: a.resolvedAt,
  offer: a.offer ? { code: a.offer.code, name: a.offer.name, type: a.offer.type, moduleNumber: a.offer.moduleNumber } : undefined,
});

export async function createCheckout(user, offerCode) {
  const offer = await prisma.productOffer.findUnique({ where: { code: offerCode } });
  if (!offer || !offer.active) throw notFound('Esta opción de acceso no está disponible');
  const access = summarizeAccess(await loadGrants(user.id));
  if (offer.type === 'TOOL_ONLY' && (access.full || access.tools.includes(offer.moduleNumber))) {
    throw conflict('Ya tienes acceso a esta herramienta');
  }
  const provider = activeProvider();
  const attempt = await prisma.paymentAttempt.create({
    data: { userId: user.id, offerId: offer.id, amount: offer.price, currency: offer.currency, provider: provider.code },
    include: { offer: true },
  });
  const checkout = await provider.createCheckout({ attempt, offer, user });
  if (checkout.providerRef) await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { providerRef: checkout.providerRef } });
  return { attempt: attemptView(attempt), checkout: { mode: checkout.mode, initPoint: checkout.initPoint || null } };
}

export async function resolveAttempt(attemptId, status, db = prisma) {
  return db.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUnique({ where: { id: attemptId }, include: { offer: true } });
    if (!attempt) throw notFound('Intento de pago no encontrado');
    if (attempt.status !== 'PENDING') return { attempt: attemptView(attempt), changed: false };
    const updated = await tx.paymentAttempt.updateMany({
      where: { id: attemptId, status: 'PENDING' },
      data: { status, resolvedAt: new Date() },
    });
    if (!updated.count) return { attempt: attemptView(attempt), changed: false };
    if (status === 'APPROVED') {
      const access = summarizeAccess(await loadGrants(attempt.userId, tx));
      const { startsAt, expiresAt } = grantWindow(attempt.offer, access.full?.expiresAt || null);
      await tx.accessGrant.create({
        data: {
          userId: attempt.userId,
          offerId: attempt.offerId,
          paymentAttemptId: attempt.id,
          accessType: attempt.offer.type,
          moduleNumber: attempt.offer.moduleNumber,
          startsAt,
          expiresAt,
        },
      });
    }
    const prefix = attempt.provider === 'MOCK' ? 'MOCK_' : '';
    await track(`${prefix}PAYMENT_${status}`, {
      userId: attempt.userId,
      metadata: { offer: attempt.offer.code, accessType: attempt.offer.type, source: attempt.provider },
    }, tx);
    return { attempt: attemptView({ ...attempt, status, resolvedAt: new Date() }), changed: true };
  });
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

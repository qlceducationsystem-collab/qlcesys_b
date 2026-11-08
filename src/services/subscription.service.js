import { prisma } from '../config/prisma.js';
import { HttpError } from '../utils/httpError.js';
import { num } from '../utils/money.js';
import { providerByCode } from './payments/providers.js';

const LIVE = ['ACTIVE', 'PENDING', 'SUSPENDED'];
export const BILLING_WHERE = { status: { in: ['ACTIVE', 'SUSPENDED'] } };
const ALREADY_CLOSED = [400, 404, 422];

export const liveSubscription = (userId, db = prisma) =>
  db.subscription.findFirst({ where: { userId, ...BILLING_WHERE, providerSubscriptionId: { not: null } }, orderBy: { createdAt: 'desc' }, include: { offer: true } });

export const subscriptionView = (sub) => sub && {
  id: sub.id,
  provider: sub.provider,
  cycle: sub.cycle,
  status: sub.status,
  amount: num(sub.amount),
  currency: sub.currency,
  nextBillingAt: sub.nextBillingAt,
  offerCode: sub.offer?.code || null,
  offerName: sub.offer?.name || null,
};

export async function cancelProviderSubscription(sub) {
  if (sub.providerSubscriptionId) {
    try {
      await providerByCode(sub.provider).cancelSubscription(sub.providerSubscriptionId);
    } catch (err) {
      if (!ALREADY_CLOSED.includes(err.providerStatus)) throw new HttpError(502, 'No pudimos cancelar tu suscripción con la pasarela de pago. Intenta de nuevo en unos minutos.');
    }
  }
  await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), nextBillingAt: null } });
}

export async function cancelUserSubscriptions(userId, { offerId } = {}) {
  const subs = await prisma.subscription.findMany({ where: { userId, status: { in: LIVE }, ...(offerId ? { offerId } : {}) } });
  for (const sub of subs) await cancelProviderSubscription(sub);
  return subs.length;
}

export const hasCancelledSubscription = async (userId) => (await prisma.subscription.count({ where: { userId, status: 'CANCELLED', providerSubscriptionId: { not: null } } })) > 0;

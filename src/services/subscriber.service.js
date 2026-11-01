import { prisma } from '../config/prisma.js';
import { isGrantActive } from '../domain/access.js';
import { forbidden } from '../utils/httpError.js';
import { num } from '../utils/money.js';
import { actorOf, recordEvent, SYSTEM } from './adminEvent.service.js';

export const SUBSCRIBER_STATES = {
  ACTIVO: 'Activo',
  CANCELADO: 'Cancelado',
  VENCIDO: 'Vencido',
  SIN_SUSCRIPCION: 'Sin suscripción',
};

const latest = (dates) => dates.filter(Boolean).map((d) => new Date(d)).reduce((max, d) => (!max || d > max ? d : max), null);

export function subscriberState(user, grants, now = new Date()) {
  const current = grants.filter((g) => isGrantActive(g, now));
  const everPaid = grants.length > 0;
  if (current.length) return user.subscriptionCancelledAt ? 'CANCELADO' : 'ACTIVO';
  if (!everPaid) return 'SIN_SUSCRIPCION';
  return user.subscriptionCancelledAt ? 'CANCELADO' : 'VENCIDO';
}

export async function listSubscribers({ state, q } = {}) {
  const term = String(q || '').trim();
  const users = await prisma.user.findMany({
    where: { role: 'CLIENT', ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }] } : {}) },
    select: {
      id: true, name: true, email: true, createdAt: true, marketingOptOut: true, subscriptionCancelledAt: true,
      accessGrants: { include: { offer: true }, orderBy: { createdAt: 'desc' } },
      paymentAttempts: { where: { status: 'APPROVED' }, orderBy: { resolvedAt: 'desc' }, take: 1, include: { offer: true } },
      promotions: { select: { status: true, validUntil: true, usedAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });
  const pending = new Set((await prisma.paymentAttempt.findMany({ where: { kind: 'PROMO', status: 'APPROVED', authorization: 'PENDING' }, select: { userId: true } })).map((a) => a.userId));
  const now = new Date();
  const rows = users.map((u) => {
    const grants = u.accessGrants.filter((g) => g.active);
    const current = grants.filter((g) => isGrantActive(g, now));
    const key = subscriberState(u, grants, now);
    const shown = current[0] || grants[0] || null;
    const lastPayment = u.paymentAttempts[0];
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt,
      marketingOptOut: u.marketingOptOut,
      state: key,
      stateLabel: SUBSCRIBER_STATES[key],
      product: shown?.offer?.name || null,
      expiresAt: current.length ? latest(current.map((g) => g.expiresAt)) : latest(grants.map((g) => g.expiresAt)),
      cancelledAt: u.subscriptionCancelledAt,
      lastPayment: lastPayment ? { amount: lastPayment.amount === null ? null : num(lastPayment.amount), date: lastPayment.resolvedAt, product: lastPayment.offer.name } : null,
      promotionsSent: u.promotions.length,
      promotionsUsed: u.promotions.filter((p) => p.usedAt).length,
      pendingAuthorization: pending.has(u.id),
    };
  });
  const counts = Object.fromEntries(Object.keys(SUBSCRIBER_STATES).map((k) => [k, rows.filter((r) => r.state === k).length]));
  return { counts, rows: state ? rows.filter((r) => (state === 'INACTIVOS' ? r.state === 'CANCELADO' || r.state === 'VENCIDO' : r.state === state)) : rows };
}

export async function cancelSubscription(user) {
  if (user.role !== 'CLIENT') throw forbidden('Solo los clientes tienen suscripción');
  const full = await prisma.user.findUnique({ where: { id: user.id }, include: { accessGrants: { where: { active: true }, include: { offer: true } } } });
  if (full.subscriptionCancelledAt) return subscriptionStatus(user);
  await prisma.user.update({ where: { id: user.id }, data: { subscriptionCancelledAt: new Date() } });
  const current = full.accessGrants.filter((g) => isGrantActive(g));
  await recordEvent({ category: 'SUSCRIPCION', type: 'CANCELADA', actor: actorOf(user), user: full, offer: current[0]?.offer || null, status: current.length ? 'Cancelado · acceso vigente hasta su vencimiento' : 'Cancelado' });
  return subscriptionStatus(user);
}

export async function resumeSubscription(user) {
  if (user.role !== 'CLIENT') throw forbidden('Solo los clientes tienen suscripción');
  const full = await prisma.user.findUnique({ where: { id: user.id }, include: { accessGrants: { where: { active: true }, include: { offer: true } } } });
  if (!full.subscriptionCancelledAt) return subscriptionStatus(user);
  await prisma.user.update({ where: { id: user.id }, data: { subscriptionCancelledAt: null } });
  const current = full.accessGrants.filter((g) => isGrantActive(g));
  await recordEvent({ category: 'SUSCRIPCION', type: 'RECUPERADA', actor: actorOf(user), user: full, offer: current[0]?.offer || null, status: 'Activo', result: 'El usuario reactivó su suscripción' });
  return subscriptionStatus(user);
}

export async function subscriptionStatus(user) {
  const full = await prisma.user.findUnique({ where: { id: user.id }, select: { subscriptionCancelledAt: true, marketingOptOut: true } });
  return { cancelledAt: full.subscriptionCancelledAt, marketingOptOut: full.marketingOptOut };
}

export async function setMarketing(user, { marketingOptOut }) {
  await prisma.user.update({ where: { id: user.id }, data: { marketingOptOut: !!marketingOptOut } });
  return subscriptionStatus(user);
}

export async function detectExpirations(now = new Date()) {
  const expired = await prisma.accessGrant.findMany({
    where: { active: true, expiryNotifiedAt: null, expiresAt: { lte: now } },
    include: { offer: true, user: true },
    take: 500,
  });
  let count = 0;
  for (const grant of expired) {
    const claimed = await prisma.accessGrant.updateMany({ where: { id: grant.id, expiryNotifiedAt: null }, data: { expiryNotifiedAt: now } });
    if (!claimed.count) continue;
    const still = await prisma.accessGrant.findMany({ where: { userId: grant.userId, active: true, accessType: grant.accessType } });
    if (still.some((g) => isGrantActive(g, now))) continue;
    await recordEvent({ category: 'SUSCRIPCION', type: 'VENCIDA', actor: SYSTEM, user: grant.user, offer: grant.offer, status: 'Vencido', result: `Venció el ${new Date(grant.expiresAt).toISOString().slice(0, 10)}` });
    count += 1;
  }
  return count;
}

export function startSubscriptionJob(intervalMinutes = 60) {
  const run = () => detectExpirations().catch((err) => console.error('[qlc] vencimientos', err.message));
  run();
  return setInterval(run, intervalMinutes * 60000);
}

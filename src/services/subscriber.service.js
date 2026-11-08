import { prisma } from '../config/prisma.js';
import { isGrantActive } from '../domain/access.js';
import { conflict, forbidden } from '../utils/httpError.js';
import { num } from '../utils/money.js';
import { actorOf, recordEvent, SYSTEM } from './adminEvent.service.js';
import { emailReady, sendClientEmail, sendEmail } from './email.service.js';
import { cancelUserSubscriptions, hasCancelledSubscription, liveSubscription, subscriptionView } from './subscription.service.js';

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
  await cancelUserSubscriptions(user.id);
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
  if (await hasCancelledSubscription(user.id)) throw conflict('Tu suscripción ya se canceló en la pasarela de pago. Para continuar, adquiere de nuevo tu acceso cuando quieras.');
  await prisma.user.update({ where: { id: user.id }, data: { subscriptionCancelledAt: null } });
  const current = full.accessGrants.filter((g) => isGrantActive(g));
  await recordEvent({ category: 'SUSCRIPCION', type: 'RECUPERADA', actor: actorOf(user), user: full, offer: current[0]?.offer || null, status: 'Activo', result: 'El usuario reactivó su suscripción' });
  return subscriptionStatus(user);
}

export async function subscriptionStatus(user) {
  const full = await prisma.user.findUnique({ where: { id: user.id }, select: { subscriptionCancelledAt: true, marketingOptOut: true } });
  const [live, cancelled] = await Promise.all([liveSubscription(user.id), hasCancelledSubscription(user.id)]);
  return { cancelledAt: full.subscriptionCancelledAt, marketingOptOut: full.marketingOptOut, billing: subscriptionView(live), canResume: !cancelled };
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
    if (grant.user.role === 'CLIENT') await sendClientEmail('ACCESO_VENCIDO', 'accessExpired', grant.user.email, { name: grant.user.name, product: grant.offer?.name }).catch(() => null);
    count += 1;
  }
  return count;
}

const RENEWAL_NOTICE_DAYS = 3;

export async function sendRenewalReminders(now = new Date(), send = sendClientEmail) {
  const limit = new Date(now.getTime() + RENEWAL_NOTICE_DAYS * 86400000);
  const grants = await prisma.accessGrant.findMany({
    where: { active: true, renewalNoticeAt: null, expiresAt: { gt: now, lte: limit }, paymentAttempt: { provider: 'BITGET' }, offer: { billingCycle: { not: null } }, user: { role: 'CLIENT' } },
    include: { offer: true, user: true },
    take: 500,
  });
  let count = 0;
  for (const grant of grants) {
    const later = await prisma.accessGrant.count({ where: { userId: grant.userId, active: true, accessType: grant.accessType, expiresAt: { gt: grant.expiresAt } } });
    if (later) {
      await prisma.accessGrant.update({ where: { id: grant.id }, data: { renewalNoticeAt: now } });
      continue;
    }
    const mail = await send('RENOVACION_PENDIENTE', 'renewalDue', grant.user.email, { name: grant.user.name, product: grant.offer.name, offerCode: grant.offer.code, expiresAt: grant.expiresAt }).catch(() => null);
    if (!mail?.sent) continue;
    await prisma.accessGrant.update({ where: { id: grant.id }, data: { renewalNoticeAt: now } });
    count += 1;
  }
  return count;
}

const RETENTION_KEY = 'retention';
const DAY = 86400000;
export const RETENTION_STEPS = [{ day: 10, left: 20 }, { day: 20, left: 10 }, { day: 29, left: 1 }];
export const RETENTION_DAYS = 30;

export async function retentionSettings() {
  const row = await prisma.appSetting.findUnique({ where: { key: RETENTION_KEY } });
  return { enabled: true, since: null, ...(row?.value || {}), steps: RETENTION_STEPS, days: RETENTION_DAYS };
}

export async function saveRetentionSettings({ enabled }) {
  const current = await retentionSettings();
  const value = { enabled: !!enabled, since: enabled ? current.since || new Date().toISOString() : current.since };
  if (enabled && !current.enabled) value.since = new Date().toISOString();
  await prisma.appSetting.upsert({ where: { key: RETENTION_KEY }, create: { key: RETENTION_KEY, value }, update: { value } });
  return retentionSettings();
}

export async function runRetention(now = new Date(), { only } = {}) {
  let settings = await retentionSettings();
  if (!settings.enabled) return { notified: 0, deleted: 0 };
  if (!(await emailReady())) {
    const value = { enabled: true, since: new Date(now).toISOString() };
    await prisma.appSetting.upsert({ where: { key: RETENTION_KEY }, create: { key: RETENTION_KEY, value }, update: { value } });
    return { notified: 0, deleted: 0, paused: true };
  }
  if (!settings.since) settings = await saveRetentionSettings({ enabled: true });
  const since = new Date(settings.since);
  const users = await prisma.user.findMany({
    where: { role: 'CLIENT', accessGrants: { some: {} }, ...(only ? { id: { in: only } } : {}) },
    select: { id: true, name: true, email: true, retentionStage: true, accessGrants: { include: { offer: true } } },
    take: 2000,
  });
  let notified = 0;
  let deleted = 0;
  for (const user of users) {
    const grants = user.accessGrants;
    if (grants.some((g) => g.active && (isGrantActive(g, now) || !g.expiresAt))) {
      if (user.retentionStage) await prisma.user.update({ where: { id: user.id }, data: { retentionStage: 0 } });
      continue;
    }
    const lastExpiry = latest(grants.map((g) => g.revokedAt && (!g.expiresAt || g.revokedAt < g.expiresAt) ? g.revokedAt : g.expiresAt));
    if (!lastExpiry) continue;
    const base = lastExpiry > since ? lastExpiry : since;
    const days = Math.floor((now - base) / DAY);
    const offer = [...grants].sort((a, b) => new Date(b.expiresAt || 0) - new Date(a.expiresAt || 0))[0]?.offer || null;
    if (days >= RETENTION_DAYS && user.retentionStage >= RETENTION_STEPS.length) {
      await recordEvent({ category: 'SUSCRIPCION', type: 'CUENTA_ELIMINADA_INACTIVIDAD', actor: SYSTEM, user, offer, status: 'Eliminada', result: `Sin renovación ${days} días después del vencimiento` }).catch(() => null);
      try {
        await cancelUserSubscriptions(user.id);
      } catch {
        continue;
      }
      await prisma.user.delete({ where: { id: user.id } }).catch(() => null);
      deleted += 1;
      continue;
    }
    const target = RETENTION_STEPS.reduce((acc, step, i) => (days >= step.day ? i + 1 : acc), 0);
    if (target <= user.retentionStage) continue;
    const left = RETENTION_STEPS[target - 1].left;
    const deleteOn = new Date(base.getTime() + RETENTION_DAYS * DAY);
    const mail = await sendEmail('retention', user.email, { name: user.name, left, deleteOn, product: offer?.name }).catch(() => null);
    if (!mail?.sent) continue;
    await prisma.user.update({ where: { id: user.id }, data: { retentionStage: target } });
    await recordEvent({ category: 'SUSCRIPCION', type: 'AVISO_RENOVACION', actor: SYSTEM, user, offer, status: 'Vencido', result: `Aviso enviado: quedan ${left} día(s) antes de eliminar la cuenta` }).catch(() => null);
    notified += 1;
  }
  return { notified, deleted };
}

export function startSubscriptionJob(intervalMinutes = 60) {
  const run = () => detectExpirations().then(() => sendRenewalReminders()).then(() => runRetention()).catch((err) => console.error('[qlc] vencimientos', err.message));
  run();
  return setInterval(run, intervalMinutes * 60000);
}

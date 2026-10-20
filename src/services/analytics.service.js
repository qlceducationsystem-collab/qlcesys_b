import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';

export const PUBLIC_EVENTS = ['PUBLIC_PAGE_VIEW', 'PUBLIC_SECTION_VIEW', 'PAYMENT_MODAL_OPEN', 'ACADEMY_OPEN', 'MODULE_OPEN'];

const SAFE_METADATA_KEYS = ['section', 'module', 'offer', 'accessType', 'status', 'route', 'passed', 'source'];

const cleanMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const entries = Object.entries(metadata)
    .filter(([k, v]) => SAFE_METADATA_KEYS.includes(k) && ['string', 'number', 'boolean'].includes(typeof v))
    .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 60) : v]);
  return entries.length ? Object.fromEntries(entries) : undefined;
};

const MAX_BUFFER = 500;
let buffer = [];

async function writeRows(rows) {
  try {
    await prisma.analyticsEvent.createMany({ data: rows });
    return true;
  } catch (err) {
    console.error('[analytics] eventos no registrados:', err.message);
    return false;
  }
}

export async function flushAnalytics() {
  if (!buffer.length) return 0;
  const rows = buffer;
  buffer = [];
  if (!(await writeRows(rows))) buffer = [...rows, ...buffer].slice(-MAX_BUFFER);
  return rows.length;
}

export function startAnalyticsFlush(minutes = env.analyticsFlushMinutes) {
  if (minutes <= 0) return null;
  return setInterval(flushAnalytics, minutes * 60000);
}

export async function track(event, { userId, sessionId, path, metadata } = {}) {
  const row = {
    event,
    userId: userId || null,
    sessionId: sessionId ? String(sessionId).slice(0, 64) : null,
    path: path ? String(path).slice(0, 120) : null,
    metadata: cleanMetadata(metadata),
    createdAt: new Date(),
  };
  if (env.analyticsFlushMinutes <= 0) return writeRows([row]);
  buffer.push(row);
  if (buffer.length >= MAX_BUFFER) await flushAnalytics();
  return true;
}

const DAY = 86400000;
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

function dailySeries(rows, days) {
  const start = Date.now() - (days - 1) * DAY;
  const keys = Array.from({ length: days }, (_, i) => dayKey(start + i * DAY));
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) if (counts[dayKey(r.createdAt)] !== undefined) counts[dayKey(r.createdAt)] += 1;
  return keys.map((k) => ({ date: k, count: counts[k] }));
}

const countBy = (rows, pick) =>
  Object.entries(rows.reduce((acc, r) => ({ ...acc, [pick(r)]: (acc[pick(r)] || 0) + 1 }), {}))
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

export async function platformMetrics({ days = 30 } = {}) {
  await flushAnalytics();
  const since = new Date(Date.now() - days * DAY);
  const now = new Date();
  const [totalUsers, newUsers, recentEvents, grants, progress, attempts, totalModules, annualReviews] = await Promise.all([
    prisma.user.count({ where: { role: 'CLIENT' } }),
    prisma.user.findMany({ where: { role: 'CLIENT', createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.analyticsEvent.findMany({ where: { createdAt: { gte: since } }, select: { event: true, createdAt: true, metadata: true, userId: true, sessionId: true } }),
    prisma.accessGrant.findMany({ where: { active: true, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { userId: true, accessType: true } }),
    prisma.moduleProgress.findMany({ select: { userId: true, status: true, module: { select: { month: true, block: true } } } }),
    prisma.paymentAttempt.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.academyModule.count(),
    prisma.annualReview.count(),
  ]);

  const byEvent = (name) => recentEvents.filter((e) => e.event === name);
  const pageViews = byEvent('PUBLIC_PAGE_VIEW');
  const sectionViews = byEvent('PUBLIC_SECTION_VIEW');
  const completedByUser = progress.filter((p) => p.status === 'COMPLETED').reduce((acc, p) => ({ ...acc, [p.userId]: (acc[p.userId] || 0) + 1 }), {});
  const learners = new Set(progress.map((p) => p.userId));
  const avgProgress = learners.size
    ? Math.round(([...learners].reduce((a, u) => a + (completedByUser[u] || 0), 0) / learners.size / Math.max(1, totalModules)) * 100)
    : 0;
  const modules = Array.from({ length: totalModules }, (_, i) => i + 1).map((m) => ({
    module: m,
    started: progress.filter((p) => p.module.month === m).length,
    completed: progress.filter((p) => p.module.month === m && p.status === 'COMPLETED').length,
  }));
  const attemptsBy = Object.fromEntries(attempts.map((a) => [a.status, a._count._all]));
  const block2Users = new Set(progress.filter((p) => p.module.block === 2).map((p) => p.userId));
  const block2 = {
    reached: block2Users.size,
    annualReviews,
    modules: modules.filter((m) => m.module >= 7).map((m) => ({
      ...m,
      completionPct: block2Users.size ? Math.round((m.completed / block2Users.size) * 100) : 0,
    })),
  };

  return {
    days,
    users: { total: totalUsers, new: newUsers.length, activeClients: new Set(grants.map((g) => g.userId)).size },
    logins: byEvent('LOGIN').length,
    registrations: byEvent('REGISTER').length,
    modules,
    block2,
    learners: learners.size,
    averageProgress: avgProgress,
    payments: { approved: attemptsBy.APPROVED || 0, rejected: attemptsBy.REJECTED || 0, pending: attemptsBy.PENDING || 0 },
    accessTypes: countBy(grants, (g) => g.accessType),
    publicViews: { total: pageViews.length, uniqueSessions: new Set(pageViews.map((e) => e.sessionId).filter(Boolean)).size },
    sections: countBy(sectionViews, (e) => e.metadata?.section || 'desconocida'),
    series: {
      publicViews: dailySeries(pageViews, days),
      registrations: dailySeries(byEvent('REGISTER'), days),
      logins: dailySeries(byEvent('LOGIN'), days),
    },
  };
}

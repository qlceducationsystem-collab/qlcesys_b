import { prisma } from '../config/prisma.js';

export async function trackLogin(userId) {
  try {
    await prisma.analyticsEvent.create({ data: { event: 'LOGIN', userId } });
  } catch (err) {
    console.error('[analytics] inicio de sesión no registrado:', err.message);
  }
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
  const since = new Date(Date.now() - days * DAY);
  const now = new Date();
  const [totalUsers, newUsers, logins, grants, progress, attempts, totalModules, annualReviews] = await Promise.all([
    prisma.user.count({ where: { role: 'CLIENT' } }),
    prisma.user.findMany({ where: { role: 'CLIENT', createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.analyticsEvent.findMany({ where: { event: 'LOGIN', createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.accessGrant.findMany({ where: { active: true, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { userId: true, accessType: true } }),
    prisma.moduleProgress.findMany({ select: { userId: true, status: true, module: { select: { month: true, block: true } } } }),
    prisma.paymentAttempt.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.academyModule.count(),
    prisma.annualReview.count(),
  ]);

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
    logins: logins.length,
    registrations: newUsers.length,
    modules,
    block2,
    learners: learners.size,
    averageProgress: avgProgress,
    payments: { approved: attemptsBy.APPROVED || 0, rejected: attemptsBy.REJECTED || 0, pending: attemptsBy.PENDING || 0 },
    accessTypes: countBy(grants, (g) => g.accessType),
    series: {
      registrations: dailySeries(newUsers, days),
      logins: dailySeries(logins, days),
    },
  };
}

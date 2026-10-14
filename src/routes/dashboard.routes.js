import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { ah } from '../utils/asyncHandler.js';
import { allocationFromPortfolio } from '../domain/learning.js';
import { getPeriodSummary, latestPeriod } from '../services/period.service.js';
import { getHistory } from '../services/history.service.js';
import { academyOverview } from '../services/academy.service.js';
import { getDiagnosis } from '../services/moduleData.service.js';

const r = Router();

r.get('/', ah(async (req, res) => {
  const userId = req.subjectId;
  const periodId = typeof req.query.periodId === 'string' && req.query.periodId ? req.query.periodId : null;
  const target = periodId ? { id: periodId } : await latestPeriod(userId);
  const [current, history, academy, diagnosis, nextAppointment] = await Promise.all([
    target ? getPeriodSummary(userId, target.id) : null,
    getHistory(userId),
    academyOverview(req),
    getDiagnosis(userId),
    prisma.appointment.findFirst({
      where: { userId, status: { in: ['PENDING', 'CONFIRMED'] }, scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
    }),
  ]);
  res.json({
    period: current?.period || null,
    summary: current?.summary || null,
    allocation: current ? allocationFromPortfolio(current.summary.portfolio.products) : null,
    history: history.slice(-12),
    diagnosis: diagnosis.result ? { result: diagnosis.result, profile: diagnosis.profile, savedAt: diagnosis.savedAt } : null,
    academy: { progressPct: academy.progressPct, next: academy.next, route: academy.route, block1: academy.block1, mode: academy.access.mode },
    nextAppointment,
  });
}));

export default r;

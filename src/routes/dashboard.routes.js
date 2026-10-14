import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { ah } from '../utils/asyncHandler.js';
import { getPeriodSummary } from '../services/period.service.js';
import { getHistory } from '../services/history.service.js';
import { listModules } from '../services/academy.service.js';

const r = Router();

// Fotografía real del usuario: periodo indicado (o el último) + evolución + academia.
r.get('/', ah(async (req, res) => {
  const userId = req.subjectId;
  const periodId = typeof req.query.periodId === 'string' && req.query.periodId ? req.query.periodId : null;
  const latest = periodId
    ? { id: periodId } // getPeriodSummary valida que pertenezca al usuario
    : await prisma.financialPeriod.findFirst({ where: { userId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  const [current, history, academy, nextAppointment] = await Promise.all([
    latest ? getPeriodSummary(userId, latest.id) : null,
    getHistory(userId),
    listModules(userId),
    prisma.appointment.findFirst({
      where: { userId, status: { in: ['PENDING', 'CONFIRMED'] }, scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
    }),
  ]);
  res.json({
    period: current?.period || null,
    summary: current?.summary || null,
    history: history.slice(-12),
    academy: { currentMonth: academy.currentMonth, unlocked: academy.unlocked, completed: academy.completed, total: academy.total, progressPct: academy.progressPct, current: academy.current },
    nextAppointment,
  });
}));

export default r;

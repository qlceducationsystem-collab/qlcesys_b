import { prisma } from '../config/prisma.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { num, round2 } from '../utils/money.js';
import { getOpenPeriod } from './period.service.js';

export const INCOME_TYPES = ['AMOUNT', 'PERCENT'];

const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const incomeDateOf = (period, day) => new Date(Date.UTC(period.year, period.month - 1, Math.min(day, lastDay(period.year, period.month)), 12));

export function incomeFor(asset, initialCapital) {
  if (!INCOME_TYPES.includes(asset.incomeType)) return 0;
  const value = num(asset.incomeValue);
  return round2(asset.incomeType === 'PERCENT' ? (num(initialCapital) * value) / 100 : value);
}

export async function applyDueIncome(userId, now = new Date()) {
  const due = await prisma.assetPosition.findMany({
    where: { incomeDate: null, period: { status: 'OPEN' }, asset: { incomeType: { in: INCOME_TYPES }, ...(userId ? { userId } : {}) } },
    include: { asset: true, period: true },
  });
  let applied = 0;
  for (const p of due) {
    const date = incomeDateOf(p.period, p.asset.incomeDay || 1);
    if (date > now) continue;
    const amount = incomeFor(p.asset, p.initialCapital);
    const updated = await prisma.assetPosition.updateMany({
      where: { id: p.id, incomeDate: null },
      data: { incomeAmount: amount, incomeDate: date, finalCapital: round2(num(p.finalCapital) + amount) },
    });
    applied += updated.count;
  }
  return applied;
}

export async function setPositionIncome(req, positionId, { amount, date }) {
  const pos = await prisma.assetPosition.findFirst({ where: { id: positionId, asset: { userId: req.subjectId } }, include: { period: true } });
  if (!pos) throw notFound('Producto no encontrado');
  await getOpenPeriod(req.subjectId, pos.periodId);
  const when = new Date(date);
  if (when.getUTCFullYear() !== pos.period.year || when.getUTCMonth() + 1 !== pos.period.month) {
    throw badRequest('La fecha de la rentabilidad debe estar dentro del mes del periodo');
  }
  const delta = round2(num(amount) - num(pos.incomeAmount));
  const finalCapital = round2(num(pos.finalCapital) + delta);
  if (finalCapital < 0) throw badRequest('El capital final no puede quedar negativo');
  return prisma.assetPosition.update({ where: { id: pos.id }, data: { incomeAmount: amount, incomeDate: when, finalCapital } });
}

export function startIncomeJob(intervalMinutes = 60) {
  const run = () => applyDueIncome().catch((err) => console.error('[qlc] rentabilidad automática', err.message));
  run();
  return setInterval(run, intervalMinutes * 60000);
}

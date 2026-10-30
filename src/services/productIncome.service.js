import { prisma } from '../config/prisma.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { num, round2 } from '../utils/money.js';
import { getOpenPeriod } from './period.service.js';

export const INCOME_TYPES = ['AMOUNT', 'PERCENT'];

const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthIndex = (year, month) => year * 12 + month;

export function withinTerm(asset, period) {
  if (!asset.incomeTerm || !asset.incomeStart) return true;
  const start = new Date(asset.incomeStart);
  const elapsed = monthIndex(period.year, period.month) - monthIndex(start.getUTCFullYear(), start.getUTCMonth() + 1);
  return elapsed >= 0 && elapsed < asset.incomeTerm;
}

export const incomeDateOf = (period, day) => new Date(Date.UTC(period.year, period.month - 1, Math.min(day, lastDay(period.year, period.month)), 12));

export async function carryForward(db, assetId, period, delta) {
  const change = round2(num(delta));
  if (!change) return;
  const later = await db.financialPeriod.findMany({
    where: { userId: period.userId, OR: [{ year: { gt: period.year } }, { year: period.year, month: { gt: period.month } }] },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });
  for (const next of later) {
    if (next.status !== 'OPEN') return;
    const pos = await db.assetPosition.findFirst({ where: { assetId, periodId: next.id } });
    if (!pos) return;
    await db.assetPosition.update({
      where: { id: pos.id },
      data: { initialCapital: round2(num(pos.initialCapital) + change), finalCapital: round2(num(pos.finalCapital) + change) },
    });
  }
}

export function incomeFor(asset, initialCapital) {
  if (!INCOME_TYPES.includes(asset.incomeType)) return 0;
  const value = num(asset.incomeValue);
  return round2(asset.incomeType === 'PERCENT' ? (num(initialCapital) * value) / 100 : value);
}

export function formIncome(asset, period, { incomeType, incomeValue, incomeDay, initialCapital, finalCapital }, now = new Date()) {
  const initial = round2(num(initialCapital));
  if (INCOME_TYPES.includes(incomeType)) {
    const date = incomeDateOf(period, incomeDay);
    if (date > now || !withinTerm(asset, period)) return { incomeAmount: 0, incomeDate: null, finalCapital: initial };
    const amount = incomeFor(asset, initial);
    return { incomeAmount: amount, incomeDate: date, finalCapital: round2(initial + amount) };
  }
  if (incomeValue !== null && incomeValue !== undefined && incomeDay) {
    const amount = round2(num(incomeValue));
    return { incomeAmount: amount, incomeDate: incomeDateOf(period, incomeDay), finalCapital: round2(initial + amount) };
  }
  return { incomeAmount: 0, incomeDate: null, finalCapital: round2(num(finalCapital)) };
}

export async function carryGaps(userId, period, db = prisma) {
  const prev = await db.financialPeriod.findFirst({
    where: { userId, OR: [{ year: { lt: period.year } }, { year: period.year, month: { lt: period.month } }] },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
  if (!prev) return [];
  if (await db.monthlyClose.findFirst({ where: { periodId: prev.id, supersededAt: null } })) return [];
  const [before, current] = await Promise.all([
    db.assetPosition.findMany({ where: { periodId: prev.id } }),
    db.assetPosition.findMany({ where: { periodId: period.id, asset: { userId } }, include: { asset: true } }),
  ]);
  return current
    .map((p) => {
      const last = before.find((b) => b.assetId === p.assetId);
      if (!last) return null;
      const gap = round2(num(last.finalCapital) - num(p.initialCapital));
      return Math.abs(gap) >= 0.01 ? { positionId: p.id, name: p.asset.name, previousFinal: num(last.finalCapital), initial: num(p.initialCapital), gap } : null;
    })
    .filter(Boolean);
}

export async function applyCarry(req, positionId) {
  const pos = await prisma.assetPosition.findFirst({ where: { id: positionId, asset: { userId: req.subjectId } }, include: { period: true } });
  if (!pos) throw notFound('Producto no encontrado');
  await getOpenPeriod(req.subjectId, pos.periodId);
  const item = (await carryGaps(req.subjectId, pos.period)).find((g) => g.positionId === pos.id);
  if (!item) throw badRequest('Este producto ya coincide con el capital final del mes anterior');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.assetPosition.update({
      where: { id: pos.id },
      data: { initialCapital: round2(num(pos.initialCapital) + item.gap), finalCapital: round2(num(pos.finalCapital) + item.gap) },
    });
    await carryForward(tx, pos.assetId, pos.period, item.gap);
    return updated;
  });
}

export async function applyDueIncome(userId, now = new Date()) {
  const due = await prisma.assetPosition.findMany({
    where: { incomeDate: null, period: { status: 'OPEN' }, asset: { incomeType: { in: INCOME_TYPES }, ...(userId ? { userId } : {}) } },
    include: { asset: true, period: true },
  });
  let applied = 0;
  for (const p of due) {
    const date = incomeDateOf(p.period, p.asset.incomeDay || 1);
    if (date > now || !withinTerm(p.asset, p.period)) continue;
    const amount = incomeFor(p.asset, p.initialCapital);
    const updated = await prisma.assetPosition.updateMany({
      where: { id: p.id, incomeDate: null },
      data: { incomeAmount: amount, incomeDate: date, finalCapital: round2(num(p.finalCapital) + amount) },
    });
    applied += updated.count;
    if (updated.count) await carryForward(prisma, p.assetId, p.period, amount);
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
  return prisma.$transaction(async (tx) => {
    const updated = await tx.assetPosition.update({ where: { id: pos.id }, data: { incomeAmount: amount, incomeDate: when, finalCapital } });
    await carryForward(tx, pos.assetId, pos.period, delta);
    return updated;
  });
}

export async function assignContribution(req, positionId, movementId) {
  const pos = await prisma.assetPosition.findFirst({ where: { id: positionId, asset: { userId: req.subjectId } }, include: { period: true } });
  if (!pos) throw notFound('Producto no encontrado');
  await getOpenPeriod(req.subjectId, pos.periodId);
  const movement = await prisma.patrimonialMovement.findFirst({ where: { id: movementId, userId: req.subjectId, periodId: pos.periodId, type: 'APORTACION', assetId: null } });
  if (!movement) throw notFound('Aportación sin asignar no encontrada en este periodo');
  const amount = num(movement.amount);
  return prisma.$transaction(async (tx) => {
    await tx.patrimonialMovement.update({ where: { id: movement.id }, data: { assetId: pos.assetId } });
    const updated = await tx.assetPosition.update({
      where: { id: pos.id },
      data: { initialCapital: round2(num(pos.initialCapital) + amount), finalCapital: round2(num(pos.finalCapital) + amount) },
    });
    await carryForward(tx, pos.assetId, pos.period, amount);
    return updated;
  });
}

export function startIncomeJob(intervalMinutes = 60) {
  const run = () => applyDueIncome().catch((err) => console.error('[qlc] rentabilidad automática', err.message));
  run();
  return setInterval(run, intervalMinutes * 60000);
}

import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { buildPeriodSummary, summarizeMovements } from '../domain/finance.js';
import { conflict, notFound } from '../utils/httpError.js';
import { num, round2, sum } from '../utils/money.js';

const periodOrder = [{ year: 'desc' }, { month: 'desc' }];
const periodIndex = (p) => p.year * 12 + p.month;

export const listPeriods = (userId) => prisma.financialPeriod.findMany({ where: { userId }, orderBy: periodOrder });

export const latestPeriod = (userId, db = prisma) => db.financialPeriod.findFirst({ where: { userId }, orderBy: periodOrder });

export async function getOwnedPeriod(userId, periodId, db = prisma) {
  const period = await db.financialPeriod.findFirst({ where: { id: periodId, userId } });
  if (!period) throw notFound('Periodo no encontrado');
  return period;
}

export function assertOpen(period) {
  if (period.status !== 'OPEN') throw conflict('El periodo está cerrado. Solo un administrador puede reabrirlo.');
}

export async function getOpenPeriod(userId, periodId, db = prisma) {
  const period = await getOwnedPeriod(userId, periodId, db);
  assertOpen(period);
  return period;
}

const previousPeriod = (userId, { year, month }, db = prisma) =>
  db.financialPeriod.findFirst({
    where: { userId, OR: [{ year: { lt: year } }, { year, month: { lt: month } }] },
    orderBy: periodOrder,
  });

export const latestClose = (periodId, db = prisma) =>
  db.monthlyClose.findFirst({ where: { periodId, supersededAt: null }, orderBy: { revision: 'desc' } });

export async function getOpening(userId, period, db = prisma, data = null) {
  const prev = await previousPeriod(userId, period, db);
  if (!prev) {
    if (period.openingNetWorth !== null && period.openingNetWorth !== undefined) return round2(num(period.openingNetWorth));
    const d = data || (await loadPeriodData(userId, period.id, db));
    return round2(sum(d.positions, (p) => p.initialCapital) - summarizeMovements(d.movements).net);
  }
  const close = await latestClose(prev.id, db);
  if (close) return round2(num(close.snapshot?.patrimony?.final));
  const positions = await db.assetPosition.findMany({ where: { periodId: prev.id } });
  return sum(positions, (p) => p.finalCapital);
}

export async function loadPeriodData(userId, periodId, db = prisma) {
  const [positions, movements, incomes, expenses, protection, debtBalances, flows] = await Promise.all([
    db.assetPosition.findMany({
      where: { periodId, asset: { userId } },
      include: { asset: { include: { category: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.patrimonialMovement.findMany({ where: { userId, periodId }, orderBy: { date: 'asc' } }),
    db.income.findMany({ where: { userId, periodId }, orderBy: { createdAt: 'asc' } }),
    db.expense.findMany({ where: { userId, periodId }, orderBy: { createdAt: 'asc' } }),
    db.protectionRecord.findMany({ where: { userId, periodId }, orderBy: { createdAt: 'asc' } }),
    db.debtBalance.findMany({ where: { periodId, debt: { userId } }, include: { debt: true }, orderBy: { createdAt: 'asc' } }),
    db.businessFlow.findMany({ where: { userId, periodId }, include: { asset: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  return {
    positions: positions.map((p) => ({
      id: p.id,
      assetId: p.assetId,
      name: p.asset.name,
      institution: p.asset.institution,
      notes: p.asset.notes,
      productType: p.asset.productType,
      source: p.asset.source,
      category: p.asset.category,
      initialCapital: p.initialCapital,
      finalCapital: p.finalCapital,
      incomeType: p.asset.incomeType,
      incomeValue: p.asset.incomeValue,
      incomeDay: p.asset.incomeDay,
      incomeAmount: p.incomeAmount,
      incomeDate: p.incomeDate,
    })),
    movements,
    incomes,
    expenses,
    protection,
    debts: debtBalances.map((b) => ({ ...b.debt, balance: b.balance, payment: b.payment, fees: b.fees, balanceId: b.id })),
    businessFlows: flows.map((f) => ({ ...f, name: f.asset.name })),
  };
}

export async function getPeriodSummary(userId, periodId, db = prisma) {
  const period = await getOwnedPeriod(userId, periodId, db);
  const data = await loadPeriodData(userId, periodId, db);
  const opening = await getOpening(userId, period, db, data);
  return { period, data, summary: buildPeriodSummary({ opening, ...data }) };
}

export async function updateOpening(userId, periodId, openingNetWorth) {
  const period = await getOpenPeriod(userId, periodId);
  if (await previousPeriod(userId, period)) throw conflict('El patrimonio inicial proviene del periodo anterior');
  return prisma.financialPeriod.update({ where: { id: period.id }, data: { openingNetWorth } });
}

export async function createPeriod(userId, { year, month, openingNetWorth }) {
  return prisma.$transaction(async (tx) => {
    const exists = await tx.financialPeriod.findFirst({ where: { userId, year, month } });
    if (exists) throw conflict('Ese periodo ya existe');
    const target = year * 12 + month;
    const latest = await tx.financialPeriod.findFirst({ where: { userId }, orderBy: periodOrder });
    const past = latest && periodIndex(latest) > target;
    if (past && !env.allowPastPeriods) throw conflict('Solo puedes crear periodos posteriores al último registrado');
    const all = past ? await tx.financialPeriod.findMany({ where: { userId } }) : [];
    const earlier = past ? all.filter((p) => periodIndex(p) < target).sort((a, b) => periodIndex(b) - periodIndex(a))[0] : latest;
    const later = past && !earlier ? all.sort((a, b) => periodIndex(a) - periodIndex(b))[0] : null;
    const prev = earlier || later;
    const period = await tx.financialPeriod.create({
      data: { userId, year, month, openingNetWorth: earlier ? null : openingNetWorth ?? null },
    });
    if (!prev) return period;

    const [positions, protection, balances] = await Promise.all([
      tx.assetPosition.findMany({ where: { periodId: prev.id } }),
      tx.protectionRecord.findMany({ where: { periodId: prev.id } }),
      tx.debtBalance.findMany({ where: { periodId: prev.id, debt: { status: 'ACTIVE' } } }),
    ]);
    if (positions.length)
      await tx.assetPosition.createMany({
        data: positions.map((p) => {
          const capital = earlier ? p.finalCapital : p.initialCapital;
          return { assetId: p.assetId, periodId: period.id, initialCapital: capital, finalCapital: capital };
        }),
      });
    if (protection.length)
      await tx.protectionRecord.createMany({
        data: protection.map((r) => ({ userId, periodId: period.id, type: r.type, name: r.name, amount: r.amount, notes: r.notes, source: r.source })),
      });
    if (balances.length)
      await tx.debtBalance.createMany({
        data: balances.map((b) => ({ debtId: b.debtId, periodId: period.id, balance: b.balance, payment: b.payment })),
      });
    return period;
  });
}

export async function ensureWorkingPeriod(userId) {
  const latest = await latestPeriod(userId);
  if (latest?.status === 'OPEN') return latest;
  const now = new Date();
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
  if (!latest || periodIndex(latest) < periodIndex(current)) return createPeriod(userId, current);
  const next = latest.month === 12 ? { year: latest.year + 1, month: 1 } : { year: latest.year, month: latest.month + 1 };
  return createPeriod(userId, next);
}

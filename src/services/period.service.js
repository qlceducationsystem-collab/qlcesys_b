import { prisma } from '../config/prisma.js';
import { buildPeriodSummary, summarizeMovements } from '../domain/finance.js';
import { conflict, notFound } from '../utils/httpError.js';
import { num, round2, sum } from '../utils/money.js';

const periodOrder = [{ year: 'desc' }, { month: 'desc' }];

export const listPeriods = (userId) => prisma.financialPeriod.findMany({ where: { userId }, orderBy: periodOrder });

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

/**
 * Patrimonio inicial: final del periodo anterior (corte si existe; si no, cartera viva).
 * Primer periodo: el valor capturado por el usuario o, si no lo capturó,
 * capital inicial registrado − movimiento neto del periodo.
 */
export async function getOpening(userId, period, db = prisma, data = null) {
  const prev = await previousPeriod(userId, period, db);
  if (!prev) {
    if (period.openingNetWorth !== null && period.openingNetWorth !== undefined) return round2(num(period.openingNetWorth));
    const d = data || (await loadPeriodData(userId, period.id, db));
    const net = summarizeMovements(d.movements).net;
    return round2(sum(d.positions, (p) => p.initialCapital) - net);
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
      category: p.asset.category,
      initialCapital: p.initialCapital,
      finalCapital: p.finalCapital,
    })),
    movements,
    incomes,
    expenses,
    protection,
    debts: debtBalances.map((b) => ({ ...b.debt, balance: b.balance, payment: b.payment, balanceId: b.id })),
    businessFlows: flows.map((f) => ({ ...f, name: f.asset.name })),
  };
}

export async function getPeriodSummary(userId, periodId, db = prisma) {
  const period = await getOwnedPeriod(userId, periodId, db);
  const data = await loadPeriodData(userId, periodId, db);
  const opening = await getOpening(userId, period, db, data);
  return { period, data, summary: buildPeriodSummary({ opening, ...data }) };
}

// Solo el primer periodo (abierto) admite capturar patrimonio inicial manual.
export async function updateOpening(userId, periodId, openingNetWorth) {
  const period = await getOpenPeriod(userId, periodId);
  if (await previousPeriod(userId, period)) throw conflict('El patrimonio inicial proviene del periodo anterior');
  return prisma.financialPeriod.update({ where: { id: period.id }, data: { openingNetWorth } });
}

/**
 * Crea un periodo. Si existe uno anterior, arrastra productos (capital inicial =
 * capital final anterior), registros de protección y saldos de deudas activas.
 */
export async function createPeriod(userId, { year, month, openingNetWorth }) {
  return prisma.$transaction(async (tx) => {
    const exists = await tx.financialPeriod.findFirst({ where: { userId, year, month } });
    if (exists) throw conflict('Ese periodo ya existe');
    // Los periodos son secuenciales: no se puede insertar uno anterior al último
    // (cambiaría silenciosamente el patrimonio inicial de periodos existentes).
    const latest = await tx.financialPeriod.findFirst({ where: { userId }, orderBy: periodOrder });
    if (latest && latest.year * 12 + latest.month > year * 12 + month) {
      throw conflict('Solo puedes crear periodos posteriores al último registrado');
    }
    const prev = latest;
    const period = await tx.financialPeriod.create({
      data: { userId, year, month, openingNetWorth: prev ? null : openingNetWorth ?? null },
    });
    if (!prev) return period;

    const [positions, protection, balances] = await Promise.all([
      tx.assetPosition.findMany({ where: { periodId: prev.id } }),
      tx.protectionRecord.findMany({ where: { periodId: prev.id } }),
      tx.debtBalance.findMany({ where: { periodId: prev.id, debt: { status: 'ACTIVE' } } }),
    ]);
    if (positions.length)
      await tx.assetPosition.createMany({
        data: positions.map((p) => ({
          assetId: p.assetId, periodId: period.id, initialCapital: p.finalCapital, finalCapital: p.finalCapital,
        })),
      });
    if (protection.length)
      await tx.protectionRecord.createMany({
        data: protection.map((r) => ({ userId, periodId: period.id, type: r.type, name: r.name, amount: r.amount, notes: r.notes })),
      });
    if (balances.length)
      await tx.debtBalance.createMany({
        data: balances.map((b) => ({ debtId: b.debtId, periodId: period.id, balance: b.balance, payment: b.payment })),
      });
    return period;
  });
}

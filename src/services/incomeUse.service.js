import { prisma } from '../config/prisma.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { num, round2 } from '../utils/money.js';
import { getOpenPeriod } from './period.service.js';
import { absorbDiagnosisExpense } from './moduleData.service.js';
import { carryForward } from './productIncome.service.js';

export const INCOME_USE = 'INCOME_USE:';
export const INCOME_USE_MOVEMENT = 'Rentabilidad usada en gastos';
export const SPEND_CATEGORIES = ['VIVIENDA', 'ALIMENTACION', 'SERVICIOS', 'TRANSPORTE', 'SEGUROS', 'EDUCACION', 'ENTRETENIMIENTO', 'VIAJES', 'OTROS'];

const sourceOf = (positionId, movementId) => `${INCOME_USE}${positionId}:${movementId}`;
const parse = (source) => {
  const [positionId, movementId] = String(source || '').slice(INCOME_USE.length).split(':');
  return { positionId, movementId };
};
export const isIncomeUse = (row) => String(row?.source || '').startsWith(INCOME_USE);

async function shiftCapital(tx, positionId, delta) {
  const pos = await tx.assetPosition.findUnique({ where: { id: positionId }, include: { period: true } });
  if (!pos) return;
  await tx.assetPosition.update({
    where: { id: pos.id },
    data: { initialCapital: round2(num(pos.initialCapital) + delta), finalCapital: round2(num(pos.finalCapital) + delta) },
  });
  await carryForward(tx, pos.assetId, pos.period, delta);
}

const spentOf = async (db, positionId) =>
  (await db.expense.findMany({ where: { source: { startsWith: `${INCOME_USE}${positionId}:` } } })).reduce((acc, e) => acc + num(e.amount), 0);

export async function listIncomeUses(userId, periodId) {
  const rows = await prisma.expense.findMany({ where: { userId, periodId, source: { startsWith: INCOME_USE } }, orderBy: { createdAt: 'asc' } });
  return rows.map((e) => ({ id: e.id, positionId: parse(e.source).positionId, category: e.category, description: e.description, amount: num(e.amount) }));
}

export async function spendIncome(req, positionId, { amount, category, description }) {
  const pos = await prisma.assetPosition.findFirst({ where: { id: positionId, asset: { userId: req.subjectId } }, include: { asset: true, period: true } });
  if (!pos) throw notFound('Producto no encontrado');
  await getOpenPeriod(req.subjectId, pos.periodId);
  const value = round2(num(amount));
  const available = round2(num(pos.incomeAmount) - (await spentOf(prisma, pos.id)));
  if (num(pos.incomeAmount) <= 0) throw badRequest('Este producto no tiene rentabilidad registrada este mes');
  if (value > available) throw badRequest(`Solo puedes usar hasta ${available.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} de la rentabilidad de este mes`);
  const date = pos.incomeDate || new Date(Date.UTC(pos.period.year, pos.period.month - 1, 1, 12));
  return prisma.$transaction(async (tx) => {
    const movement = await tx.patrimonialMovement.create({
      data: { userId: req.subjectId, periodId: pos.periodId, assetId: pos.assetId, type: 'DEDUCCION', amount: value, date, description: `${INCOME_USE_MOVEMENT} · ${pos.asset.name}` },
    });
    const expense = await tx.expense.create({
      data: { userId: req.subjectId, periodId: pos.periodId, category, description: description || `Rentabilidad de ${pos.asset.name}`, amount: value, source: sourceOf(pos.id, movement.id) },
    });
    await absorbDiagnosisExpense(tx, { userId: req.subjectId, periodId: pos.periodId, category, delta: value });
    await shiftCapital(tx, pos.id, -value);
    return expense;
  });
}

export async function releaseIncomeUse(tx, expense) {
  const { positionId, movementId } = parse(expense.source);
  await tx.patrimonialMovement.deleteMany({ where: { id: movementId } });
  await shiftCapital(tx, positionId, num(expense.amount));
}

export async function undoIncomeUse(req, expenseId) {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, userId: req.subjectId, source: { startsWith: INCOME_USE } } });
  if (!expense) throw notFound('Movimiento no encontrado');
  await getOpenPeriod(req.subjectId, expense.periodId);
  await prisma.$transaction(async (tx) => {
    await tx.expense.delete({ where: { id: expense.id } });
    await absorbDiagnosisExpense(tx, { userId: req.subjectId, periodId: expense.periodId, category: expense.category, delta: -num(expense.amount) });
    await releaseIncomeUse(tx, expense);
  });
}

export async function releaseByMovement(tx, movement) {
  const expense = await tx.expense.findFirst({ where: { userId: movement.userId, source: { endsWith: `:${movement.id}`, startsWith: INCOME_USE } } });
  if (!expense) return;
  await tx.expense.delete({ where: { id: expense.id } });
  await absorbDiagnosisExpense(tx, { userId: movement.userId, periodId: expense.periodId, category: expense.category, delta: -num(expense.amount) });
  const { positionId } = parse(expense.source);
  await shiftCapital(tx, positionId, num(expense.amount));
}

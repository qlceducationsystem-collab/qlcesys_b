import { prisma } from '../config/prisma.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { num, round2 } from '../utils/money.js';
import { customCategory, customName, isCustomCategory } from '../domain/patrimonial.js';
import { getOpenPeriod } from './period.service.js';
import { absorbDiagnosisExpense } from './moduleData.service.js';
import { carriedPositionIds, carryForward, carryGaps, syncCarry } from './productIncome.service.js';
import { getBudget } from './budget.service.js';

export const INCOME_USE = 'INCOME_USE:';
export const SPEND_CATEGORIES = ['VIVIENDA', 'ALIMENTACION', 'SERVICIOS', 'TRANSPORTE', 'SEGUROS', 'EDUCACION', 'ENTRETENIMIENTO', 'VIAJES', 'OTROS'];
const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

async function shiftCapital(tx, positionId, delta) {
  const pos = await tx.assetPosition.findUnique({ where: { id: positionId }, include: { period: true } });
  if (!pos) return null;
  const updated = await tx.assetPosition.update({
    where: { id: pos.id },
    data: { initialCapital: round2(num(pos.initialCapital) + delta), finalCapital: round2(num(pos.finalCapital) + delta) },
  });
  await carryForward(tx, pos.assetId, pos.period, delta);
  return updated;
}

const movementDate = (period, pos) => {
  if (pos.incomeDate) return pos.incomeDate;
  const now = new Date();
  const start = new Date(Date.UTC(period.year, period.month - 1, 1, 12));
  const end = new Date(Date.UTC(period.year, period.month, 0, 12));
  return now < start ? start : now > end ? end : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
};

async function ensureCustomLine(tx, userId, period, key) {
  const where = { userId_year_month: { userId, year: period.year, month: period.month } };
  const budget = await tx.budget.findUnique({ where, include: { lines: true } });
  if (budget) {
    if (!budget.lines.some((l) => l.category === key)) await tx.budgetLine.create({ data: { budgetId: budget.id, category: key, percent: 0 } });
    return;
  }
  const current = await getBudget(userId, { year: period.year, month: period.month }, tx);
  const created = await tx.budget.create({ data: { userId, year: period.year, month: period.month, netIncome: current.netIncome } });
  await tx.budgetLine.createMany({ data: [...current.lines, { category: key, percent: 0 }].map((l) => ({ budgetId: created.id, category: l.category, percent: l.percent })) });
}

const usedFromMonth = async (db, positionId) =>
  num((await db.incomeUse.aggregate({ where: { positionId, origin: 'MONTH' }, _sum: { amount: true } }))._sum.amount);

export async function incomeOptions(userId, period) {
  await syncCarry(userId, period);
  const [positions, gaps, uses, carried] = await Promise.all([
    prisma.assetPosition.findMany({ where: { periodId: period.id, asset: { userId } }, include: { asset: true }, orderBy: { createdAt: 'asc' } }),
    carryGaps(userId, period),
    prisma.incomeUse.findMany({ where: { userId, periodId: period.id }, orderBy: { createdAt: 'asc' } }),
    carriedPositionIds(userId, period),
  ]);
  const nameOf = (id) => positions.find((p) => p.id === id)?.asset.name || '';
  const month = positions
    .map((p) => {
      const used = uses.filter((u) => u.positionId === p.id && u.origin === 'MONTH').reduce((acc, u) => acc + num(u.amount), 0);
      return { positionId: p.id, name: p.asset.name, income: num(p.incomeAmount), available: round2(num(p.incomeAmount) - used) };
    })
    .filter((m) => m.available > 0.004);
  return {
    carry: gaps,
    carried,
    month,
    uses: uses.map((u) => ({
      id: u.id,
      positionId: u.positionId,
      name: nameOf(u.positionId),
      origin: u.origin,
      kind: u.kind,
      amount: num(u.amount),
      category: u.category,
      categoryName: u.category && isCustomCategory(u.category) ? customName(u.category) : u.category,
      targetName: u.targetPositionId ? nameOf(u.targetPositionId) : null,
    })),
  };
}

async function categoryOf(userId, { category, newCategory }) {
  if (newCategory) return { key: customCategory(newCategory), created: true };
  if (SPEND_CATEGORIES.includes(category) || isCustomCategory(category)) return { key: category, created: false };
  throw badRequest('Elige una categoría de gasto o escribe una nueva');
}

export async function useIncome(req, positionId, body) {
  const userId = req.subjectId;
  const pos = await prisma.assetPosition.findFirst({ where: { id: positionId, asset: { userId } }, include: { asset: true, period: true } });
  if (!pos) throw notFound('Producto no encontrado');
  const period = await getOpenPeriod(userId, pos.periodId);
  const amount = round2(num(body.amount));
  let available;
  if (body.origin === 'CARRY') {
    available = (await carryGaps(userId, period)).find((g) => g.positionId === pos.id)?.gap || 0;
    if (available <= 0) throw badRequest('Este producto no tiene rentabilidad del mes anterior por decidir');
  } else {
    if (num(pos.incomeAmount) <= 0) throw badRequest('Este producto no tiene rentabilidad registrada este mes');
    available = round2(num(pos.incomeAmount) - (await usedFromMonth(prisma, pos.id)));
  }
  if (amount <= 0) throw badRequest('El monto debe ser mayor a 0');
  if (amount > available + 0.004) throw badRequest(`Solo puedes usar hasta ${mxn.format(available)}`);

  const category = body.kind === 'EXPENSE' ? await categoryOf(userId, body) : null;
  let target = null;
  if (body.kind === 'INVEST' && body.targetPositionId) {
    target = await prisma.assetPosition.findFirst({ where: { id: body.targetPositionId, periodId: pos.periodId, asset: { userId } }, include: { asset: true } });
    if (!target || target.id === pos.id) throw badRequest('Elige otra inversión de este mes');
  } else if (body.kind === 'INVEST') {
    if (!body.newProduct?.name || !body.newProduct?.categoryCode) throw badRequest('Indica la categoría y el nombre de la nueva inversión');
    if (!(await prisma.assetCategory.findUnique({ where: { code: body.newProduct.categoryCode } }))) throw badRequest('Categoría no válida');
  }
  const date = movementDate(period, pos);

  return prisma.$transaction(async (tx) => {
    const use = await tx.incomeUse.create({
      data: { userId, periodId: pos.periodId, positionId: pos.id, origin: body.origin === 'CARRY' ? 'CARRY' : 'MONTH', kind: body.kind, amount, category: category?.key || null },
    });
    let createdTarget = false;
    if (body.kind === 'INVEST' && !target) {
      const cat = await tx.assetCategory.findUnique({ where: { code: body.newProduct.categoryCode } });
      const asset = await tx.asset.create({ data: { userId, categoryId: cat.id, name: body.newProduct.name } });
      target = { ...(await tx.assetPosition.create({ data: { assetId: asset.id, periodId: pos.periodId, initialCapital: 0, finalCapital: 0 } })), asset };
      createdTarget = true;
    }
    const out = await tx.patrimonialMovement.create({
      data: {
        userId, periodId: pos.periodId, assetId: pos.assetId, type: 'DEDUCCION', amount, date,
        description: body.kind === 'EXPENSE' ? `Rentabilidad usada en gastos · ${pos.asset.name}` : `Rentabilidad pasada a ${target.asset.name} · ${pos.asset.name}`,
      },
    });
    if (use.origin === 'MONTH') await shiftCapital(tx, pos.id, -amount);
    const data = { outMovementId: out.id, createdTarget };
    if (body.kind === 'EXPENSE') {
      const custom = isCustomCategory(category.key);
      const expenseCategory = custom ? 'OTROS' : category.key;
      const expense = await tx.expense.create({
        data: {
          userId, periodId: pos.periodId, category: expenseCategory, amount,
          description: body.description || `Rentabilidad de ${pos.asset.name}`,
          source: `${INCOME_USE}${use.id}${custom ? `|${category.key}` : ''}`,
        },
      });
      await absorbDiagnosisExpense(tx, { userId, periodId: pos.periodId, category: expenseCategory, delta: amount });
      if (custom) await ensureCustomLine(tx, userId, period, category.key);
      data.expenseId = expense.id;
    } else {
      const inbound = await tx.patrimonialMovement.create({
        data: { userId, periodId: pos.periodId, assetId: target.assetId, type: 'APORTACION', amount, date, description: `Rentabilidad recibida de ${pos.asset.name}` },
      });
      await shiftCapital(tx, target.id, amount);
      data.inMovementId = inbound.id;
      data.targetPositionId = target.id;
    }
    return tx.incomeUse.update({ where: { id: use.id }, data });
  });
}

export async function revertUse(tx, use, { skipExpense = false, skipMovement = null } = {}) {
  if (use.expenseId && !skipExpense) {
    const expense = await tx.expense.findUnique({ where: { id: use.expenseId } });
    if (expense) {
      await tx.expense.delete({ where: { id: expense.id } });
      await absorbDiagnosisExpense(tx, { userId: use.userId, periodId: use.periodId, category: expense.category, delta: -num(expense.amount) });
    }
  }
  const movements = [use.outMovementId, use.inMovementId].filter((id) => id && id !== skipMovement);
  if (movements.length) await tx.patrimonialMovement.deleteMany({ where: { id: { in: movements } } });
  if (use.origin === 'MONTH') await shiftCapital(tx, use.positionId, num(use.amount));
  if (use.targetPositionId) {
    const target = await shiftCapital(tx, use.targetPositionId, -num(use.amount));
    if (use.createdTarget && target && num(target.initialCapital) === 0 && num(target.finalCapital) === 0) {
      await tx.assetPosition.delete({ where: { id: target.id } });
      if (!(await tx.assetPosition.count({ where: { assetId: target.assetId } }))) await tx.asset.delete({ where: { id: target.assetId } });
    }
  }
  await tx.incomeUse.delete({ where: { id: use.id } });
}

export async function undoIncomeUse(req, useId) {
  const use = await prisma.incomeUse.findFirst({ where: { id: useId, userId: req.subjectId } });
  if (!use) throw notFound('Movimiento no encontrado');
  await getOpenPeriod(req.subjectId, use.periodId);
  await prisma.$transaction((tx) => revertUse(tx, use));
}

export async function onExpenseWrite(tx, before, after) {
  if (!before) return;
  const use = await tx.incomeUse.findFirst({ where: { expenseId: before.id } });
  if (!use) return;
  if (after) throw badRequest('Este gasto viene de la rentabilidad de un producto: cámbielo o deshágalo desde Mi portafolio de inversión.');
  await revertUse(tx, use, { skipExpense: true });
}

export async function onMovementWrite(tx, before, after) {
  if (!before) return;
  const use = await tx.incomeUse.findFirst({ where: { OR: [{ outMovementId: before.id }, { inMovementId: before.id }] } });
  if (!use) return;
  if (after) throw badRequest('Este movimiento viene de la rentabilidad de un producto: cámbielo o deshágalo desde Mi portafolio de inversión.');
  await revertUse(tx, use, { skipMovement: before.id });
}

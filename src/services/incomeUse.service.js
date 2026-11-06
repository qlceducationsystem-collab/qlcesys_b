import { prisma } from '../config/prisma.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { num, round2 } from '../utils/money.js';
import { customName, isCustomCategory } from '../domain/patrimonial.js';
import { CATEGORY_PRODUCT } from '../domain/learning.js';
import { getOpenPeriod } from './period.service.js';
import { absorbDiagnosisExpense } from './moduleData.service.js';
import { carriedPositionIds, carryForward, carryGaps, syncCarry } from './productIncome.service.js';
import { adjustRecord } from './emergency.service.js';

const SAVE_LABELS = { FONDO_EMERGENCIA: 'fondo de emergencia', META_PATRIMONIAL: 'meta patrimonial' };

export const INCOME_USE = 'INCOME_USE:';
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

async function shiftBudgetIncome(tx, userId, periodId, delta) {
  const period = await tx.financialPeriod.findUnique({ where: { id: periodId } });
  if (!period) return;
  const where = { userId_year_month: { userId, year: period.year, month: period.month } };
  const budget = await tx.budget.findUnique({ where });
  if (budget) await tx.budget.update({ where, data: { netIncome: Math.max(0, round2(num(budget.netIncome) + delta)) } });
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

  if (body.kind === 'SAVE' && !SAVE_LABELS[body.destination]) throw badRequest('Elige si va al fondo de emergencia o a la meta patrimonial');
  if (body.kind === 'SAVE' && body.destination === 'META_PATRIMONIAL' && !(await prisma.goal.findFirst({ where: { userId, kind: 'PATRIMONIO' } }))) throw badRequest('Primero define tu meta patrimonial en el Módulo 8');
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
      data: { userId, periodId: pos.periodId, positionId: pos.id, origin: body.origin === 'CARRY' ? 'CARRY' : 'MONTH', kind: body.kind, amount, category: body.kind === 'SAVE' ? body.destination : null },
    });
    let createdTarget = false;
    if (body.kind === 'INVEST' && !target) {
      const cat = await tx.assetCategory.findUnique({ where: { code: body.newProduct.categoryCode } });
      const kind = CATEGORY_PRODUCT[cat.code];
      const asset = await tx.asset.create({
        data: {
          userId, categoryId: cat.id, name: body.newProduct.name, breakdown: false,
          ...(kind ? { productType: kind, horizon: body.newProduct.horizon || 'MEDIANO', liquidityLevel: body.newProduct.liquidityLevel || 'MEDIA', perceivedRisk: body.newProduct.perceivedRisk || 'MEDIO' } : {}),
        },
      });
      target = { ...(await tx.assetPosition.create({ data: { assetId: asset.id, periodId: pos.periodId, initialCapital: 0, finalCapital: 0 } })), asset };
      createdTarget = true;
    }
    const out = await tx.patrimonialMovement.create({
      data: {
        userId, periodId: pos.periodId, assetId: pos.assetId, type: 'DEDUCCION', amount, date,
        description: body.kind === 'INCOME' ? `Rentabilidad pasada a ingresos · ${pos.asset.name}` : body.kind === 'SAVE' ? `Rentabilidad enviada a ${SAVE_LABELS[body.destination]} · ${pos.asset.name}` : `Rentabilidad pasada a ${target.asset.name} · ${pos.asset.name}`,
      },
    });
    if (use.origin === 'MONTH') await shiftCapital(tx, pos.id, -amount);
    const data = { outMovementId: out.id, createdTarget };
    if (body.kind === 'INCOME') {
      const income = await tx.income.create({
        data: { userId, periodId: pos.periodId, category: 'OTROS', amount, description: `Rentabilidad de ${pos.asset.name} pasada desde tu portafolio`, source: `${INCOME_USE}${use.id}` },
      });
      await shiftBudgetIncome(tx, userId, pos.periodId, amount);
      data.incomeId = income.id;
    } else if (body.kind === 'SAVE') {
      const contribution = await tx.savingContribution.create({
        data: { userId, periodId: pos.periodId, destination: body.destination, amount, date: new Date(), description: body.description || `Rentabilidad de ${pos.asset.name}` },
      });
      await adjustRecord(tx, userId, pos.periodId, body.destination, amount);
      data.contributionId = contribution.id;
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

export async function revertUse(tx, use, { skipExpense = false, skipIncome = false, skipMovement = null } = {}) {
  if (use.incomeId) {
    if (!skipIncome) await tx.income.deleteMany({ where: { id: use.incomeId } });
    await shiftBudgetIncome(tx, use.userId, use.periodId, -num(use.amount));
  }
  if (use.contributionId) {
    const contribution = await tx.savingContribution.findUnique({ where: { id: use.contributionId } });
    if (contribution) {
      await tx.savingContribution.delete({ where: { id: contribution.id } });
      await adjustRecord(tx, use.userId, contribution.periodId, contribution.destination, -num(contribution.amount));
    }
  }
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

export async function onIncomeWrite(tx, before, after) {
  if (!before) return;
  const use = await tx.incomeUse.findFirst({ where: { incomeId: before.id } });
  if (!use) return;
  if (after) throw badRequest('Este ingreso viene de la rentabilidad de un producto: cámbielo o deshágalo desde Mi portafolio de inversión.');
  await revertUse(tx, use, { skipIncome: true });
}

export async function onMovementWrite(tx, before, after) {
  if (!before) return;
  const use = await tx.incomeUse.findFirst({ where: { OR: [{ outMovementId: before.id }, { inMovementId: before.id }] } });
  if (!use) return;
  if (after) throw badRequest('Este movimiento viene de la rentabilidad de un producto: cámbielo o deshágalo desde Mi portafolio de inversión.');
  await revertUse(tx, use, { skipMovement: before.id });
}

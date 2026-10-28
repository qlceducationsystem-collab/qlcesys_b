import { prisma } from '../config/prisma.js';
import { BUDGET_CATEGORIES, BUDGET_DEFAULTS, budgetView, DIAGNOSIS_PENDING, isCustomCategory } from '../domain/patrimonial.js';
import { badRequest, conflict } from '../utils/httpError.js';
import { num } from '../utils/money.js';
import { createContribution } from './emergency.service.js';
import { absorbDiagnosisExpense } from './moduleData.service.js';

const ADJUST_SOURCE = 'M7_ADJUST';
const INVEST_ADJUST = 'Aportación registrada desde el presupuesto (M7)';
const customSource = (category) => `M7_${category}`;
const customAdjustSource = (category) => `M7_ADJUST_${category}`;
const customKey = (source) => source?.match(/^M7_(?:ADJUST_)?(CUSTOM:.+)$/)?.[1] || null;
const bucketOf = (row) => (row.source === 'M1_EXPENSES' ? DIAGNOSIS_PENDING : customKey(row.source) || row.category);
const expenseCategoryOf = (category) => (isCustomCategory(category) ? 'OTROS' : category);
const adjustSourceOf = (category) => (isCustomCategory(category) ? customAdjustSource(category) : ADJUST_SOURCE);
const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

const ORDER = new Map(BUDGET_CATEGORIES.map((c, i) => [c, i]));
const CUSTOM_ORDER = ORDER.get('OTROS') + 0.5;
const orderOf = (category) => (ORDER.has(category) ? ORDER.get(category) : CUSTOM_ORDER);
const sortLines = (lines) => [...lines].sort((a, b) => orderOf(a.category) - orderOf(b.category));
const DEFAULT_LINES = BUDGET_DEFAULTS.map(([category, percent]) => ({ category, percent }));

const findPeriod = (userId, { year, month }, db = prisma) => db.financialPeriod.findFirst({ where: { userId, year, month } });

const findBudget = (userId, { year, month }, db = prisma) =>
  db.budget.findUnique({ where: { userId_year_month: { userId, year, month } }, include: { lines: true } });

export async function monthActuals(userId, periodId, db = prisma) {
  if (!periodId) return {};
  const [expenses, contributions, investments] = await Promise.all([
    db.expense.groupBy({ by: ['category', 'source'], where: { userId, periodId }, _sum: { amount: true } }),
    db.savingContribution.aggregate({ where: { userId, periodId }, _sum: { amount: true } }),
    db.patrimonialMovement.aggregate({ where: { userId, periodId, type: 'APORTACION' }, _sum: { amount: true } }),
  ]);
  const byBucket = {};
  for (const e of expenses) {
    const key = bucketOf(e);
    byBucket[key] = (byBucket[key] || 0) + num(e._sum.amount);
  }
  return {
    ...byBucket,
    AHORRO: num(contributions._sum.amount),
    INVERSION: num(investments._sum.amount),
  };
}

const realIncome = async (userId, periodId, db = prisma) =>
  periodId ? num((await db.income.aggregate({ where: { userId, periodId }, _sum: { amount: true } }))._sum.amount) : 0;

export async function getBudget(userId, month, db = prisma) {
  const [budget, period] = await Promise.all([findBudget(userId, month, db), findPeriod(userId, month, db)]);
  const [actuals, income] = await Promise.all([monthActuals(userId, period?.id, db), realIncome(userId, period?.id, db)]);
  const lines = budget ? sortLines(budget.lines.map((l) => ({ category: l.category, percent: num(l.percent) }))) : DEFAULT_LINES;
  const netIncome = budget ? num(budget.netIncome) : income;
  return {
    ...month,
    saved: !!budget,
    updatedAt: budget?.updatedAt || null,
    period: period ? { id: period.id, status: period.status } : null,
    realIncome: income,
    netIncome,
    lines,
    actuals,
    view: budgetView({ netIncome, lines, actuals }),
  };
}

export async function budgetHistory(userId) {
  const budgets = await prisma.budget.findMany({ where: { userId }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 24, include: { lines: true } });
  return budgets.map((b) => ({
    year: b.year,
    month: b.month,
    netIncome: num(b.netIncome),
    updatedAt: b.updatedAt,
    lines: sortLines(b.lines.map((l) => ({ category: l.category, percent: num(l.percent) }))),
  }));
}

export async function budgetSnapshot(userId, period, db = prisma) {
  const budget = await findBudget(userId, period, db);
  if (!budget) return null;
  const actuals = await monthActuals(userId, period.id, db);
  const lines = sortLines(budget.lines.map((l) => ({ category: l.category, percent: num(l.percent) })));
  return { year: period.year, month: period.month, view: budgetView({ netIncome: num(budget.netIncome), lines, actuals }) };
}

const percentMessage = (gap) => `Los porcentajes deben sumar 100%. ${gap > 0 ? 'Faltan' : 'Sobran'} ${Math.abs(gap).toFixed(2)}%.`;

async function assertMonthEditable(userId, month) {
  const period = await findPeriod(userId, month);
  if (period?.status === 'CLOSED') throw conflict('El mes ya tiene un corte cerrado. Solicita la reapertura para modificar su presupuesto.');
  return period;
}

export async function saveBudget(req, { year, month, netIncome, lines }) {
  const userId = req.subjectId;
  const view = budgetView({ netIncome, lines });
  if (!view.complete) throw badRequest(percentMessage(view.percentGap), { percentTotal: view.percentTotal, percentGap: view.percentGap });
  await assertMonthEditable(userId, { year, month });
  await prisma.$transaction(async (tx) => {
    const budget = await tx.budget.upsert({
      where: { userId_year_month: { userId, year, month } },
      create: { userId, year, month, netIncome },
      update: { netIncome },
    });
    await tx.budgetLine.deleteMany({ where: { budgetId: budget.id } });
    await tx.budgetLine.createMany({ data: lines.map((l) => ({ budgetId: budget.id, category: l.category, percent: l.percent })) });
  });
  return getBudget(userId, { year, month });
}

async function requirePeriod(userId, month) {
  const period = await assertMonthEditable(userId, month);
  if (!period) throw badRequest('Ese mes aún no tiene periodo en Ingresos y gastos. Créalo antes de registrar movimientos reales.');
  return period;
}

export async function recordActual(req, { year, month, category, amount, description }) {
  const userId = req.subjectId;
  const period = await requirePeriod(userId, { year, month });
  if (category === 'AHORRO') {
    await createContribution(req, period, { destination: 'AHORRO', amount, description });
  } else {
    const expenseCategory = expenseCategoryOf(category);
    await prisma.$transaction(async (tx) => {
      await tx.expense.create({ data: { userId, periodId: period.id, category: expenseCategory, description, amount, source: isCustomCategory(category) ? customSource(category) : 'M7_BUDGET' } });
      await absorbDiagnosisExpense(tx, { userId, periodId: period.id, category: expenseCategory, delta: amount });
    });
  }
  return getBudget(userId, { year, month });
}

async function setSaving(req, period, amount) {
  const current = num((await prisma.savingContribution.aggregate({ where: { userId: req.subjectId, periodId: period.id }, _sum: { amount: true } }))._sum.amount);
  if (amount < current) throw badRequest(`Ya registraste ${mxn.format(current)} de ahorro este mes. Para reducirlo elimina aportaciones en el Módulo 8 · Fondo de emergencia.`);
  if (amount > current) await createContribution(req, period, { destination: 'AHORRO', amount: amount - current, description: 'Ajuste desde el presupuesto (M7)' });
}

async function setInvestment(userId, period, amount) {
  const movements = await prisma.patrimonialMovement.findMany({ where: { userId, periodId: period.id, type: 'APORTACION' } });
  const adjust = movements.find((m) => !m.assetId && m.description === INVEST_ADJUST);
  const recorded = movements.filter((m) => m !== adjust).reduce((acc, m) => acc + num(m.amount), 0);
  const difference = Math.round((amount - recorded) * 100) / 100;
  if (difference < 0) throw badRequest(`En Movimientos ya hay ${mxn.format(recorded)} en aportaciones este mes. Para bajar el importe real, edita esos movimientos.`);
  if (difference === 0) {
    if (adjust) await prisma.patrimonialMovement.delete({ where: { id: adjust.id } });
  } else if (adjust) {
    await prisma.patrimonialMovement.update({ where: { id: adjust.id }, data: { amount: difference } });
  } else {
    await prisma.patrimonialMovement.create({
      data: { userId, periodId: period.id, type: 'APORTACION', amount: difference, description: INVEST_ADJUST, date: new Date(Date.UTC(period.year, period.month - 1, 1, 12)) },
    });
  }
}

async function setExpense(userId, period, category, amount) {
  const expenseCategory = expenseCategoryOf(category);
  const adjustSource = adjustSourceOf(category);
  const rows = (await prisma.expense.findMany({ where: { userId, periodId: period.id, category: expenseCategory } })).filter((r) => bucketOf(r) === category);
  const adjust = rows.find((r) => r.source === adjustSource);
  const recorded = rows.filter((r) => r !== adjust).reduce((acc, r) => acc + num(r.amount), 0);
  const difference = Math.round((amount - recorded) * 100) / 100;
  if (difference < 0) throw badRequest(`En Ingresos y gastos ya hay ${mxn.format(recorded)} registrados en esta categoría. Para bajar el importe real, edita esos movimientos.`);
  const previous = adjust ? num(adjust.amount) : 0;
  await prisma.$transaction(async (tx) => {
    if (difference === 0) {
      if (adjust) await tx.expense.delete({ where: { id: adjust.id } });
    } else if (adjust) {
      await tx.expense.update({ where: { id: adjust.id }, data: { amount: difference } });
    } else {
      await tx.expense.create({ data: { userId, periodId: period.id, category: expenseCategory, description: 'Ajuste desde el presupuesto (M7)', amount: difference, source: adjustSource } });
    }
    await absorbDiagnosisExpense(tx, { userId, periodId: period.id, category: expenseCategory, delta: difference - previous });
  });
}

export async function confirmRealExpenses(req, month) {
  const userId = req.subjectId;
  const period = await requirePeriod(userId, month);
  await prisma.expense.deleteMany({ where: { userId, periodId: period.id, source: 'M1_EXPENSES' } });
  return getBudget(userId, month);
}

export async function setActual(req, { year, month, category, amount }) {
  const userId = req.subjectId;
  const period = await requirePeriod(userId, { year, month });
  if (category === 'AHORRO') await setSaving(req, period, amount);
  else if (category === 'INVERSION') await setInvestment(userId, period, amount);
  else await setExpense(userId, period, category, amount);
  return getBudget(userId, { year, month });
}

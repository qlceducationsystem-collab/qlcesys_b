import { prisma } from '../config/prisma.js';
import { BUDGET_CATEGORIES, BUDGET_DEFAULTS, budgetView } from '../domain/patrimonial.js';
import { badRequest, conflict } from '../utils/httpError.js';
import { num } from '../utils/money.js';
import { createContribution } from './emergency.service.js';

const ORDER = new Map(BUDGET_CATEGORIES.map((c, i) => [c, i]));
const sortLines = (lines) => [...lines].sort((a, b) => ORDER.get(a.category) - ORDER.get(b.category));
const DEFAULT_LINES = BUDGET_DEFAULTS.map(([category, percent]) => ({ category, percent }));

const findPeriod = (userId, { year, month }, db = prisma) => db.financialPeriod.findFirst({ where: { userId, year, month } });

const findBudget = (userId, { year, month }, db = prisma) =>
  db.budget.findUnique({ where: { userId_year_month: { userId, year, month } }, include: { lines: true } });

export async function monthActuals(userId, periodId, db = prisma) {
  if (!periodId) return {};
  const [expenses, contributions, investments] = await Promise.all([
    db.expense.groupBy({ by: ['category'], where: { userId, periodId }, _sum: { amount: true } }),
    db.savingContribution.aggregate({ where: { userId, periodId }, _sum: { amount: true } }),
    db.patrimonialMovement.aggregate({ where: { userId, periodId, type: 'APORTACION' }, _sum: { amount: true } }),
  ]);
  return {
    ...Object.fromEntries(expenses.map((e) => [e.category, num(e._sum.amount)])),
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

export async function recordActual(req, { year, month, category, amount, description }) {
  const userId = req.subjectId;
  const period = await assertMonthEditable(userId, { year, month });
  if (!period) throw badRequest('Ese mes aún no tiene periodo en Ingresos y gastos. Créalo antes de registrar movimientos reales.');
  if (category === 'AHORRO') {
    await createContribution(req, period, { destination: 'AHORRO', amount, description });
  } else {
    await prisma.expense.create({ data: { userId, periodId: period.id, category, description, amount, source: 'M7_BUDGET' } });
  }
  return getBudget(userId, { year, month });
}

import { prisma } from '../config/prisma.js';
import { emergencyFund, ESSENTIAL_CATEGORIES, isEssentialCategory } from '../domain/patrimonial.js';
import { notFound } from '../utils/httpError.js';
import { num } from '../utils/money.js';
import { logAdminChange } from './audit.service.js';
import { assertOpen, ensureWorkingPeriod, getPeriodSummary, latestPeriod } from './period.service.js';

const DEFAULT_TARGET_MONTHS = 3;

const CONTRIBUTION_RECORD = {
  FONDO_EMERGENCIA: { source: 'M8_FUND', type: 'FONDO_EMERGENCIA', name: 'Fondo de emergencia · aportaciones confirmadas' },
  AHORRO: { source: 'M7_SAVINGS', type: 'RESERVA', name: 'Ahorro · aportaciones confirmadas' },
};

const planView = (plan) =>
  plan && {
    targetMonths: plan.targetMonths,
    monthlyContribution: num(plan.monthlyContribution),
    declaredEssential: plan.declaredEssential === null ? null : num(plan.declaredEssential),
    useDeclared: plan.useDeclared,
    updatedAt: plan.updatedAt,
  };

async function essentialFromData(userId, period, summary, db = prisma) {
  const real = summary.cashflow.expenseByCategory.filter((e) => isEssentialCategory(e.key));
  const realTotal = real.reduce((a, e) => a + num(e.amount), 0);
  if (realTotal > 0) return { amount: realTotal, source: 'MOVEMENTS', breakdown: real.map((e) => ({ category: e.key, amount: num(e.amount) })) };
  const budget = await db.budget.findUnique({ where: { userId_year_month: { userId, year: period.year, month: period.month } }, include: { lines: true } });
  const planned = (budget?.lines || [])
    .filter((l) => isEssentialCategory(l.category))
    .map((l) => ({ category: l.category, amount: (num(budget.netIncome) * num(l.percent)) / 100 }));
  const plannedTotal = planned.reduce((a, e) => a + e.amount, 0);
  if (plannedTotal > 0) return { amount: plannedTotal, source: 'BUDGET', breakdown: planned };
  return { amount: 0, source: 'NONE', breakdown: [] };
}

export function liquidityOf(summary) {
  const portfolio = num(summary.portfolio.categories.find((c) => c.code === 'LIQUIDEZ')?.final);
  return { amount: portfolio + num(summary.protection.total), portfolio, protection: num(summary.protection.total), byType: summary.protection.byType };
}

export async function emergencyFor(userId, period, summary, plan, db = prisma) {
  const auto = await essentialFromData(userId, period, summary, db);
  const declared = plan?.useDeclared && plan.declaredEssential !== null;
  const essential = declared ? { amount: num(plan.declaredEssential), source: 'DECLARED', breakdown: [] } : auto;
  const liquid = liquidityOf(summary);
  const result = emergencyFund({
    essentialExpenses: essential.amount,
    liquid: liquid.amount,
    targetMonths: plan?.targetMonths ?? DEFAULT_TARGET_MONTHS,
    monthlyContribution: plan ? num(plan.monthlyContribution) : 0,
  });
  return { essential, autoEssential: auto, liquid, result };
}

export async function getEmergency(userId) {
  const [period, plan] = await Promise.all([latestPeriod(userId), prisma.emergencyFundPlan.findUnique({ where: { userId } })]);
  if (!period) {
    return {
      period: null,
      saved: !!plan,
      plan: planView(plan),
      essentialCategories: ESSENTIAL_CATEGORIES,
      essential: { amount: plan?.useDeclared ? num(plan.declaredEssential) : 0, source: plan?.useDeclared ? 'DECLARED' : 'NONE', breakdown: [] },
      liquid: { amount: 0, portfolio: 0, protection: 0, byType: [] },
      result: emergencyFund({ essentialExpenses: plan?.useDeclared ? num(plan.declaredEssential) : 0, liquid: 0, targetMonths: plan?.targetMonths ?? DEFAULT_TARGET_MONTHS, monthlyContribution: num(plan?.monthlyContribution) }),
      contributions: [],
    };
  }
  const { summary } = await getPeriodSummary(userId, period.id);
  const [data, contributions] = await Promise.all([
    emergencyFor(userId, period, summary, plan),
    prisma.savingContribution.findMany({ where: { userId, periodId: period.id }, orderBy: { date: 'desc' } }),
  ]);
  return {
    period: { id: period.id, year: period.year, month: period.month, status: period.status },
    saved: !!plan,
    plan: planView(plan),
    essentialCategories: ESSENTIAL_CATEGORIES,
    ...data,
    contributions: contributions.map((c) => ({ id: c.id, destination: c.destination, amount: num(c.amount), date: c.date, description: c.description })),
  };
}

export async function emergencySnapshot(userId, period, summary, db = prisma) {
  const plan = await db.emergencyFundPlan.findUnique({ where: { userId } });
  const data = await emergencyFor(userId, period, summary, plan, db);
  return { saved: !!plan, essentialSource: data.essential.source, ...data.result };
}

export async function savePlan(req, input) {
  const userId = req.subjectId;
  const data = {
    targetMonths: input.targetMonths,
    monthlyContribution: input.monthlyContribution,
    declaredEssential: input.declaredEssential ?? null,
    useDeclared: input.useDeclared && input.declaredEssential !== null && input.declaredEssential !== undefined,
  };
  const before = await prisma.emergencyFundPlan.findUnique({ where: { userId } });
  const row = await prisma.emergencyFundPlan.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  await logAdminChange(req, { module: 'MODULO_8', action: before ? 'UPDATE' : 'CREATE', entityId: row.id, before: planView(before), after: planView(row) });
  return getEmergency(userId);
}

async function adjustRecord(tx, userId, periodId, destination, delta) {
  const cfg = CONTRIBUTION_RECORD[destination];
  const record = await tx.protectionRecord.findFirst({ where: { userId, periodId, source: cfg.source } });
  if (!record) {
    if (delta > 0) await tx.protectionRecord.create({ data: { userId, periodId, type: cfg.type, name: cfg.name, amount: delta, source: cfg.source } });
    return;
  }
  const amount = num(record.amount) + delta;
  if (amount <= 0) await tx.protectionRecord.delete({ where: { id: record.id } });
  else await tx.protectionRecord.update({ where: { id: record.id }, data: { amount } });
}

export async function createContribution(req, period, { destination, amount, description }) {
  assertOpen(period);
  const userId = req.subjectId;
  return prisma.$transaction(async (tx) => {
    const row = await tx.savingContribution.create({ data: { userId, periodId: period.id, destination, amount, description, date: new Date() } });
    await adjustRecord(tx, userId, period.id, destination, num(amount));
    await logAdminChange(req, { module: 'APORTACIONES', action: 'CREATE', entityId: row.id, after: { destination, amount, description } }, tx);
    return row;
  });
}

export async function addContribution(req, input) {
  const period = await ensureWorkingPeriod(req.subjectId);
  await createContribution(req, period, input);
  return getEmergency(req.subjectId);
}

export async function deleteContribution(req, id) {
  const userId = req.subjectId;
  const row = await prisma.savingContribution.findFirst({ where: { id, userId }, include: { period: true } });
  if (!row) throw notFound('Aportación no encontrada');
  assertOpen(row.period);
  await prisma.$transaction(async (tx) => {
    await tx.savingContribution.delete({ where: { id } });
    await adjustRecord(tx, userId, row.periodId, row.destination, -num(row.amount));
    await logAdminChange(req, { module: 'APORTACIONES', action: 'DELETE', entityId: id, before: { destination: row.destination, amount: num(row.amount) } }, tx);
  });
  return getEmergency(userId);
}

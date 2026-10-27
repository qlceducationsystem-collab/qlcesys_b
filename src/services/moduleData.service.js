import { prisma } from '../config/prisma.js';
import { allocationFromPortfolio, diagnose, PLACEHOLDERS, placeholderAmounts, PRODUCT_CATEGORY } from '../domain/learning.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { num, round2 } from '../utils/money.js';
import { ensureWorkingPeriod, getPeriodSummary, latestPeriod } from './period.service.js';

const categoryId = async (tx, code) => {
  const cat = await tx.assetCategory.findUnique({ where: { code } });
  if (!cat) throw badRequest(`Categoría ${code} no configurada`);
  return cat.id;
};

async function upsertSourced(tx, model, { userId, periodId, source }, data) {
  const existing = await tx[model].findFirst({ where: { userId, periodId, source } });
  if (num(data.amount) <= 0) {
    if (existing) await tx[model].delete({ where: { id: existing.id } });
    return;
  }
  if (existing) await tx[model].update({ where: { id: existing.id }, data });
  else await tx[model].create({ data: { userId, periodId, source, ...data } });
}

export const DIAGNOSIS_EXPENSE_SOURCES = ['M1_EXPENSES', 'M1_DEBT_PAYMENT'];
export const DIAGNOSIS_DEBT_SOURCE = 'M1_DEBT';
const diagnosisSource = (category) => (category === 'DEUDAS' ? 'M1_DEBT_PAYMENT' : 'M1_EXPENSES');
export const isDiagnosisExpense = (row) => DIAGNOSIS_EXPENSE_SOURCES.includes(row?.source);
const detailedWhere = { OR: [{ source: null }, { source: { notIn: DIAGNOSIS_EXPENSE_SOURCES } }] };

export async function absorbDiagnosisExpense(db, { userId, periodId, category, delta }) {
  if (!delta) return;
  const placeholder = await db.expense.findFirst({ where: { userId, periodId, source: diagnosisSource(category) } });
  if (!placeholder) return;
  const amount = round2(Math.max(0, num(placeholder.amount) - delta));
  if (amount > 0) await db.expense.update({ where: { id: placeholder.id }, data: { amount } });
  else await db.expense.delete({ where: { id: placeholder.id } });
}

export async function absorbExpenseChange(db, userId, before, after) {
  if (before && !isDiagnosisExpense(before)) await absorbDiagnosisExpense(db, { userId, periodId: before.periodId, category: before.category, delta: -num(before.amount) });
  if (after && !isDiagnosisExpense(after)) await absorbDiagnosisExpense(db, { userId, periodId: after.periodId, category: after.category, delta: num(after.amount) });
}

async function syncDiagnosisExpenses(tx, scope, { expenses, debtPayment }) {
  const rows = await tx.expense.groupBy({ by: ['category'], where: { ...scope, ...detailedWhere }, _sum: { amount: true } });
  const detailed = (debts) => rows.filter((r) => (r.category === 'DEUDAS') === debts).reduce((acc, r) => acc + num(r._sum.amount), 0);
  await upsertSourced(tx, 'expense', { ...scope, source: 'M1_EXPENSES' }, { category: 'OTROS', description: 'Gastos mensuales por desglosar (diagnóstico)', amount: round2(Math.max(0, num(expenses) - detailed(false))) });
  await upsertSourced(tx, 'expense', { ...scope, source: 'M1_DEBT_PAYMENT' }, { category: 'DEUDAS', description: 'Pago mensual de deudas por desglosar (diagnóstico)', amount: round2(Math.max(0, num(debtPayment) - detailed(true))) });
}

const DIAGNOSIS_DEBT_NAME = 'Deudas por desglosar (diagnóstico)';
const diagnosisDebtBalance = (db, userId, periodId) => db.debtBalance.findFirst({ where: { periodId, debt: { userId, source: DIAGNOSIS_DEBT_SOURCE } }, include: { debt: true } });
const renameDiagnosisDebt = async (db, debt) => {
  if (debt.name !== DIAGNOSIS_DEBT_NAME) await db.debt.update({ where: { id: debt.id }, data: { name: DIAGNOSIS_DEBT_NAME } });
};

export async function absorbDiagnosisDebt(db, { userId, periodId, balance = 0, payment = 0 }) {
  if (!balance && !payment) return;
  const placeholder = await diagnosisDebtBalance(db, userId, periodId);
  if (!placeholder) return;
  const data = { balance: round2(Math.max(0, num(placeholder.balance) - balance)), payment: round2(Math.max(0, num(placeholder.payment) - payment)) };
  if (data.balance > 0 || data.payment > 0) {
    await db.debtBalance.update({ where: { id: placeholder.id }, data });
    await renameDiagnosisDebt(db, placeholder.debt);
    return;
  }
  await db.debtBalance.delete({ where: { id: placeholder.id } });
  if (!(await db.debtBalance.count({ where: { debtId: placeholder.debtId } }))) await db.debt.delete({ where: { id: placeholder.debtId } });
}

async function upsertSourcedDebt(tx, { userId, periodId }, { balance, payment }) {
  const others = await tx.debtBalance.aggregate({
    where: { periodId, debt: { userId, OR: [{ source: null }, { source: { not: DIAGNOSIS_DEBT_SOURCE } }] } },
    _sum: { balance: true, payment: true },
  });
  const pendingBalance = round2(Math.max(0, num(balance) - num(others._sum.balance)));
  const pendingPayment = round2(Math.max(0, num(payment) - num(others._sum.payment)));
  let debt = await tx.debt.findFirst({ where: { userId, source: DIAGNOSIS_DEBT_SOURCE } });
  const current = debt ? await tx.debtBalance.findUnique({ where: { debtId_periodId: { debtId: debt.id, periodId } } }) : null;
  if (pendingBalance <= 0 && pendingPayment <= 0) {
    if (current) await tx.debtBalance.delete({ where: { id: current.id } });
    if (debt && !(await tx.debtBalance.count({ where: { debtId: debt.id } }))) await tx.debt.delete({ where: { id: debt.id } });
    return;
  }
  if (!debt) debt = await tx.debt.create({ data: { userId, name: DIAGNOSIS_DEBT_NAME, annualRate: null, source: DIAGNOSIS_DEBT_SOURCE } });
  else await renameDiagnosisDebt(tx, debt);
  await tx.debtBalance.upsert({
    where: { debtId_periodId: { debtId: debt.id, periodId } },
    create: { debtId: debt.id, periodId, balance: pendingBalance, payment: pendingPayment },
    update: { balance: pendingBalance, payment: pendingPayment },
  });
}

const RECONCILE_KEY = 'fix:diagnosis-breakdown-v1';

async function setPlaceholderExpense(tx, row, amount) {
  if (!row) return;
  if (amount > 0) await tx.expense.update({ where: { id: row.id }, data: { amount } });
  else await tx.expense.delete({ where: { id: row.id } });
}

async function reconcilePeriod(tx, userId, periodId, declared) {
  const scope = { userId, periodId };
  const [placeholders, detailed, debt, others] = await Promise.all([
    tx.expense.findMany({ where: { ...scope, source: { in: DIAGNOSIS_EXPENSE_SOURCES } } }),
    tx.expense.groupBy({ by: ['category'], where: { ...scope, ...detailedWhere }, _sum: { amount: true } }),
    diagnosisDebtBalance(tx, userId, periodId),
    tx.debtBalance.aggregate({ where: { periodId, debt: { userId, OR: [{ source: null }, { source: { not: DIAGNOSIS_DEBT_SOURCE } }] } }, _sum: { balance: true, payment: true } }),
  ]);
  const detailedOf = (debts) => detailed.filter((r) => (r.category === 'DEUDAS') === debts).reduce((acc, r) => acc + num(r._sum.amount), 0);
  await setPlaceholderExpense(tx, placeholders.find((r) => r.source === 'M1_EXPENSES'), round2(Math.max(0, num(declared.expenses) - detailedOf(false))));
  await setPlaceholderExpense(tx, placeholders.find((r) => r.source === 'M1_DEBT_PAYMENT'), round2(Math.max(0, num(declared.debtPayment) - detailedOf(true))));
  if (!debt) return;
  const data = {
    balance: round2(Math.max(0, num(declared.totalDebt) - num(others._sum.balance))),
    payment: round2(Math.max(0, num(declared.debtPayment) - num(others._sum.payment))),
  };
  if (data.balance > 0 || data.payment > 0) {
    await tx.debtBalance.update({ where: { id: debt.id }, data });
    await renameDiagnosisDebt(tx, debt.debt);
  } else {
    await tx.debtBalance.delete({ where: { id: debt.id } });
    if (!(await tx.debtBalance.count({ where: { debtId: debt.debtId } }))) await tx.debt.delete({ where: { id: debt.debtId } });
  }
}

export async function reconcileDiagnosisBreakdown() {
  if (await prisma.publicSection.findUnique({ where: { key: RECONCILE_KEY } })) return 0;
  const submissions = await prisma.moduleSubmission.findMany({ where: { moduleNumber: 1 }, orderBy: { createdAt: 'desc' }, distinct: ['userId'] });
  let periods = 0;
  for (const sub of submissions) {
    const [expenseRows, debtRows] = await Promise.all([
      prisma.expense.findMany({ where: { userId: sub.userId, source: { in: DIAGNOSIS_EXPENSE_SOURCES }, period: { status: 'OPEN' } }, select: { periodId: true } }),
      prisma.debtBalance.findMany({ where: { debt: { userId: sub.userId, source: DIAGNOSIS_DEBT_SOURCE }, period: { status: 'OPEN' } }, select: { periodId: true } }),
    ]);
    for (const periodId of new Set([...expenseRows, ...debtRows].map((r) => r.periodId))) {
      await prisma.$transaction((tx) => reconcilePeriod(tx, sub.userId, periodId, sub.data || {}));
      periods += 1;
    }
  }
  await prisma.publicSection.create({ data: { key: RECONCILE_KEY, navLabel: 'Ajuste de datos', position: 0, title: 'Desglose del diagnóstico', active: false } });
  return periods;
}

const isFirstPosition = async (tx, assetId, periodId) => !(await tx.assetPosition.count({ where: { assetId, NOT: { periodId } } }));

async function setPositionCapital(tx, assetId, periodId, capital) {
  const firstPeriod = await isFirstPosition(tx, assetId, periodId);
  await tx.assetPosition.upsert({
    where: { assetId_periodId: { assetId, periodId } },
    create: { assetId, periodId, initialCapital: firstPeriod ? capital : 0, finalCapital: capital },
    update: firstPeriod ? { initialCapital: capital, finalCapital: capital } : { finalCapital: capital },
  });
}

async function removePosition(tx, assetId, periodId) {
  await tx.assetPosition.deleteMany({ where: { assetId, periodId } });
  if (!(await tx.assetPosition.count({ where: { assetId } }))) await tx.asset.delete({ where: { id: assetId } });
}

const productRows = (tx, userId, periodId) =>
  tx.assetPosition.findMany({
    where: { periodId, asset: { userId, productType: { not: null }, source: null } },
    include: { asset: { include: { category: true } } },
    orderBy: { createdAt: 'asc' },
  });

export async function syncPlaceholders(tx, userId, periodId) {
  const profile = await tx.financialProfile.findUnique({ where: { userId } });
  if (!profile) return;
  const products = (await productRows(tx, userId, periodId)).map((p) => ({ productType: p.asset.productType, capital: p.finalCapital }));
  const amounts = placeholderAmounts(profile, products);
  for (const [source, cfg] of Object.entries(PLACEHOLDERS)) {
    const asset = await tx.asset.findFirst({ where: { userId, source } });
    if (amounts[source] > 0) {
      const target = asset || (await tx.asset.create({ data: { userId, source, name: cfg.name, categoryId: await categoryId(tx, cfg.category) } }));
      const capital = amounts[source];
      await tx.assetPosition.upsert({
        where: { assetId_periodId: { assetId: target.id, periodId } },
        create: { assetId: target.id, periodId, initialCapital: capital, finalCapital: capital },
        update: { initialCapital: capital, finalCapital: capital },
      });
    } else if (asset) {
      await removePosition(tx, asset.id, periodId);
    }
  }
}

const profileView = (p) =>
  p && {
    monthlyInvestment: num(p.monthlyInvestment),
    emergencyFund: num(p.emergencyFund),
    declaredCash: num(p.declaredCash),
    declaredInvestments: num(p.declaredInvestments),
    declaredOtherAssets: num(p.declaredOtherAssets),
    riskTolerance: p.riskTolerance,
    mainGoal: p.mainGoal,
    diagnosedAt: p.diagnosedAt,
    updatedAt: p.updatedAt,
  };

export async function getDiagnosis(userId) {
  const [profile, submission] = await Promise.all([
    prisma.financialProfile.findUnique({ where: { userId } }),
    prisma.moduleSubmission.findFirst({ where: { userId, moduleNumber: 1 }, orderBy: { createdAt: 'desc' } }),
  ]);
  return { profile: profileView(profile), input: submission?.data || null, result: submission ? { ...submission.result, ...diagnose(submission.data) } : null, savedAt: submission?.createdAt || null };
}

export async function saveDiagnosis(req, input) {
  const userId = req.subjectId;
  const period = await ensureWorkingPeriod(userId);
  const result = diagnose(input);
  const scope = { userId, periodId: period.id };
  await prisma.$transaction(async (tx) => {
    const profileData = {
      monthlyInvestment: input.monthlyInvestment,
      emergencyFund: input.emergencyFund,
      declaredCash: input.cash,
      declaredInvestments: input.investments,
      declaredOtherAssets: input.otherAssets,
      riskTolerance: input.riskTolerance,
      mainGoal: input.mainGoal,
    };
    await tx.financialProfile.upsert({ where: { userId }, create: { userId, ...profileData }, update: profileData });
    await upsertSourced(tx, 'income', { ...scope, source: 'M1_INCOME' }, { category: 'OTROS', description: 'Ingreso mensual (diagnóstico)', amount: input.income });
    await syncDiagnosisExpenses(tx, scope, input);
    await upsertSourcedDebt(tx, scope, { balance: input.totalDebt, payment: input.debtPayment });
    await syncPlaceholders(tx, userId, period.id);
    await tx.moduleSubmission.create({ data: { userId, moduleNumber: 1, data: input, result } });
  });
  return { result, periodId: period.id };
}

const productView = (p) => ({
  assetId: p.assetId,
  positionId: p.id,
  name: p.asset.name,
  productType: p.asset.productType,
  categoryCode: p.asset.category.code,
  categoryName: p.asset.category.name,
  capital: num(p.finalCapital),
  horizon: p.asset.horizon,
  liquidityLevel: p.asset.liquidityLevel,
  perceivedRisk: p.asset.perceivedRisk,
});

export async function listProducts(userId) {
  const period = await latestPeriod(userId);
  if (!period) return { period: null, products: [], pending: null };
  const [rows, profile] = await Promise.all([productRows(prisma, userId, period.id), prisma.financialProfile.findUnique({ where: { userId } })]);
  const products = rows.map(productView);
  const pending = profile ? placeholderAmounts(profile, products) : null;
  return { period, products, pending };
}

const assetFields = (d) => ({
  name: d.name,
  productType: d.productType,
  horizon: d.horizon,
  liquidityLevel: d.liquidityLevel,
  perceivedRisk: d.perceivedRisk,
});

export async function addProduct(req, data) {
  const userId = req.subjectId;
  const period = await ensureWorkingPeriod(userId);
  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: { userId, ...assetFields(data), categoryId: await categoryId(tx, PRODUCT_CATEGORY[data.productType]) },
    });
    await tx.assetPosition.create({ data: { assetId: asset.id, periodId: period.id, initialCapital: data.capital, finalCapital: data.capital } });
    await syncPlaceholders(tx, userId, period.id);
    return asset;
  });
}

async function ownedProduct(tx, userId, assetId) {
  const asset = await tx.asset.findFirst({ where: { id: assetId, userId, productType: { not: null }, source: null } });
  if (!asset) throw notFound('Producto no encontrado');
  return asset;
}

export async function updateProduct(req, assetId, data) {
  const userId = req.subjectId;
  const period = await ensureWorkingPeriod(userId);
  return prisma.$transaction(async (tx) => {
    await ownedProduct(tx, userId, assetId);
    const asset = await tx.asset.update({
      where: { id: assetId },
      data: { ...assetFields(data), categoryId: await categoryId(tx, PRODUCT_CATEGORY[data.productType]) },
    });
    await setPositionCapital(tx, assetId, period.id, data.capital);
    await syncPlaceholders(tx, userId, period.id);
    return asset;
  });
}

export async function deleteProduct(req, assetId) {
  const userId = req.subjectId;
  const period = await ensureWorkingPeriod(userId);
  await prisma.$transaction(async (tx) => {
    await ownedProduct(tx, userId, assetId);
    await removePosition(tx, assetId, period.id);
    await syncPlaceholders(tx, userId, period.id);
  });
}

export async function currentAllocation(userId) {
  const period = await latestPeriod(userId);
  if (!period) return { period: null, allocation: allocationFromPortfolio([]) };
  const { summary } = await getPeriodSummary(userId, period.id);
  return { period, allocation: allocationFromPortfolio(summary.portfolio.products) };
}

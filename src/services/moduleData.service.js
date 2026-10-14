import { prisma } from '../config/prisma.js';
import { allocationFromPortfolio, diagnose, PLACEHOLDERS, placeholderAmounts, PRODUCT_CATEGORY } from '../domain/learning.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { num } from '../utils/money.js';
import { ensureWorkingPeriod, getPeriodSummary, latestPeriod } from './period.service.js';
import { logAdminChange } from './audit.service.js';

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

async function upsertSourcedDebt(tx, { userId, periodId }, { balance, payment }) {
  let debt = await tx.debt.findFirst({ where: { userId, source: 'M1_DEBT' } });
  const current = debt ? await tx.debtBalance.findUnique({ where: { debtId_periodId: { debtId: debt.id, periodId } } }) : null;
  if (num(balance) <= 0 && num(payment) <= 0) {
    if (current) await tx.debtBalance.delete({ where: { id: current.id } });
    if (debt && !(await tx.debtBalance.count({ where: { debtId: debt.id } }))) await tx.debt.delete({ where: { id: debt.id } });
    return;
  }
  if (!debt) debt = await tx.debt.create({ data: { userId, name: 'Deudas totales (diagnóstico)', annualRate: null, source: 'M1_DEBT' } });
  await tx.debtBalance.upsert({
    where: { debtId_periodId: { debtId: debt.id, periodId } },
    create: { debtId: debt.id, periodId, balance, payment },
    update: { balance, payment },
  });
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
  return { profile: profileView(profile), input: submission?.data || null, result: submission?.result || null, savedAt: submission?.createdAt || null };
}

export async function saveDiagnosis(req, input) {
  const userId = req.subjectId;
  const period = await ensureWorkingPeriod(userId);
  const result = diagnose(input);
  const scope = { userId, periodId: period.id };
  await prisma.$transaction(async (tx) => {
    const before = await tx.financialProfile.findUnique({ where: { userId } });
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
    await upsertSourced(tx, 'expense', { ...scope, source: 'M1_EXPENSES' }, { category: 'OTROS', description: 'Gastos mensuales (diagnóstico)', amount: input.expenses });
    await upsertSourced(tx, 'expense', { ...scope, source: 'M1_DEBT_PAYMENT' }, { category: 'DEUDAS', description: 'Pago mensual de deudas (diagnóstico)', amount: input.debtPayment });
    await upsertSourcedDebt(tx, scope, { balance: input.totalDebt, payment: input.debtPayment });
    await syncPlaceholders(tx, userId, period.id);
    await tx.moduleSubmission.create({ data: { userId, moduleNumber: 1, data: input, result } });
    await logAdminChange(req, { module: 'MODULO_1', action: before ? 'UPDATE' : 'CREATE', before: profileView(before), after: profileData }, tx);
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
    await logAdminChange(req, { module: 'MODULO_2', action: 'CREATE', entityId: asset.id, after: data }, tx);
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
    const before = await ownedProduct(tx, userId, assetId);
    const asset = await tx.asset.update({
      where: { id: assetId },
      data: { ...assetFields(data), categoryId: await categoryId(tx, PRODUCT_CATEGORY[data.productType]) },
    });
    await setPositionCapital(tx, assetId, period.id, data.capital);
    await syncPlaceholders(tx, userId, period.id);
    await logAdminChange(req, { module: 'MODULO_2', action: 'UPDATE', entityId: assetId, before: assetFields(before), after: assetFields(asset) }, tx);
    return asset;
  });
}

export async function deleteProduct(req, assetId) {
  const userId = req.subjectId;
  const period = await ensureWorkingPeriod(userId);
  await prisma.$transaction(async (tx) => {
    const before = await ownedProduct(tx, userId, assetId);
    await removePosition(tx, assetId, period.id);
    await syncPlaceholders(tx, userId, period.id);
    await logAdminChange(req, { module: 'MODULO_2', action: 'DELETE', entityId: assetId, before: assetFields(before) }, tx);
  });
}

export async function currentAllocation(userId) {
  const period = await latestPeriod(userId);
  if (!period) return { period: null, allocation: allocationFromPortfolio([]) };
  const { summary } = await getPeriodSummary(userId, period.id);
  return { period, allocation: allocationFromPortfolio(summary.portfolio.products) };
}

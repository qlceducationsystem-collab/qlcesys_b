import { prisma } from '../config/prisma.js';
import { inflationScenario, inflationTotals, taxConsolidated, taxItem } from '../domain/patrimonial.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { num } from '../utils/money.js';
import { getPeriodSummary, latestPeriod } from './period.service.js';

const TAX_FIELDS = ['name', 'type', 'period', 'capital', 'grossProfit', 'commissions', 'otherCosts', 'taxRate', 'sourceAssetId'];
const SCENARIO_FIELDS = ['name', 'type', 'capital', 'years', 'inflationRate', 'nominalRate', 'sourceAssetId', 'sourceGoalId'];
const pickFields = (row, fields) => Object.fromEntries(fields.map((f) => [f, row[f] !== null && typeof row[f] === 'object' && 'toNumber' in row[f] ? num(row[f]) : row[f]]));

async function assertOwnedAsset(userId, assetId) {
  if (!assetId) return;
  if (!(await prisma.asset.count({ where: { id: assetId, userId } }))) throw badRequest('El activo seleccionado no pertenece a tu cuenta');
}

async function assertOwnedGoal(userId, goalId) {
  if (!goalId) return;
  if (!(await prisma.goal.count({ where: { id: goalId, userId } }))) throw badRequest('La meta seleccionada no pertenece a tu cuenta');
}

function crud({ model, validateRefs, view }) {
  const owned = async (userId, id) => {
    const row = await prisma[model].findFirst({ where: { id, userId } });
    if (!row) throw notFound('Registro no encontrado');
    return row;
  };
  return {
    async create(req, data) {
      await validateRefs(req.subjectId, data);
      const row = await prisma[model].create({ data: { ...data, userId: req.subjectId } });
      return view(row);
    },
    async update(req, id, data) {
      await owned(req.subjectId, id);
      await validateRefs(req.subjectId, data);
      const row = await prisma[model].update({ where: { id }, data });
      return view(row);
    },
    async remove(req, id) {
      await owned(req.subjectId, id);
      await prisma[model].delete({ where: { id } });
    },
  };
}

const taxView = (row) => {
  const input = pickFields(row, TAX_FIELDS);
  return { id: row.id, ...input, createdAt: row.createdAt, updatedAt: row.updatedAt, result: taxItem(input) };
};

const scenarioView = (row) => {
  const input = pickFields(row, SCENARIO_FIELDS);
  return { id: row.id, ...input, createdAt: row.createdAt, updatedAt: row.updatedAt, result: inflationScenario(input) };
};

export const taxItems = crud({
  model: 'taxAnalysisItem',
  validateRefs: (userId, d) => assertOwnedAsset(userId, d.sourceAssetId),
  view: taxView,
});

export const scenarios = crud({
  model: 'inflationScenario',
  validateRefs: async (userId, d) => {
    await assertOwnedAsset(userId, d.sourceAssetId);
    await assertOwnedGoal(userId, d.sourceGoalId);
  },
  view: scenarioView,
});

async function currentAssets(userId) {
  const period = await latestPeriod(userId);
  if (!period) return [];
  const { summary } = await getPeriodSummary(userId, period.id);
  return summary.portfolio.products.map((p) => ({ id: p.assetId, name: p.name, category: p.categoryName, capital: p.final, source: p.source }));
}

export async function listTaxItems(userId) {
  const [rows, assets] = await Promise.all([
    prisma.taxAnalysisItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    currentAssets(userId),
  ]);
  const items = rows.map(taxView);
  return { items, consolidated: taxConsolidated(items), assets };
}

export async function listScenarios(userId) {
  const [rows, assets, goals] = await Promise.all([
    prisma.inflationScenario.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    currentAssets(userId),
    prisma.goal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ]);
  const items = rows.map(scenarioView);
  return {
    items,
    totals: inflationTotals(items),
    sources: { assets, goals: goals.map((g) => ({ id: g.id, name: g.name, kind: g.kind, targetAmount: num(g.targetAmount) })) },
  };
}

const goalView = (g) => g && { id: g.id, kind: g.kind, name: g.name, targetAmount: num(g.targetAmount), targetDate: g.targetDate, updatedAt: g.updatedAt };

export const patrimonialGoal = async (userId) =>
  goalView(await prisma.goal.findFirst({ where: { userId, kind: 'PATRIMONIO' }, orderBy: { updatedAt: 'desc' } }));

export async function savePatrimonialGoal(req, { name, targetAmount }) {
  const userId = req.subjectId;
  const existing = await prisma.goal.findFirst({ where: { userId, kind: 'PATRIMONIO' }, orderBy: { updatedAt: 'desc' } });
  const data = { name: name || 'Meta patrimonial', targetAmount };
  const row = existing
    ? await prisma.goal.update({ where: { id: existing.id }, data })
    : await prisma.goal.create({ data: { userId, kind: 'PATRIMONIO', ...data } });
  return goalView(row);
}

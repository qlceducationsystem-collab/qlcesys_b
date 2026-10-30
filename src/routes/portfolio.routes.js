import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { ah } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.js';
import { assetSchema, incomeSpendSchema, periodQuery, positionIncomeSchema } from '../validations/schemas.js';
import { listIncomeUses, spendIncome, undoIncomeUse } from '../services/incomeUse.service.js';
import { applyCarry, applyDueIncome, assignContribution, carryForward, carryGaps, formIncome, setPositionIncome } from '../services/productIncome.service.js';
import { getOpenPeriod, getPeriodSummary } from '../services/period.service.js';
import { capitalResult } from '../domain/finance.js';

const r = Router();

async function categoryId(code) {
  const cat = await prisma.assetCategory.findUnique({ where: { code } });
  if (!cat) throw badRequest('Categoría no válida');
  return cat.id;
}

const autoType = (t) => (t === 'AMOUNT' || t === 'PERCENT' ? t : null);

const sameIncome = (asset, body) =>
  asset.incomeType === autoType(body.incomeType)
  && Number(asset.incomeValue ?? 0) === Number(body.incomeValue ?? 0)
  && (asset.incomeDay ?? null) === (body.incomeDay ?? null)
  && (asset.incomeTerm ?? null) === (body.incomeTerm ?? null);

const periodStart = (period) => new Date(Date.UTC(period.year, period.month - 1, 1, 12));

const incomeFields = ({ incomeType, incomeValue, incomeDay, incomeTerm }, start) => {
  const type = autoType(incomeType);
  return {
    incomeType: type,
    incomeValue: type ? incomeValue : null,
    incomeDay: type ? incomeDay : null,
    incomeTerm: type ? incomeTerm : null,
    incomeStart: type ? start : null,
  };
};

async function ownedPosition(req) {
  const pos = await prisma.assetPosition.findFirst({
    where: { id: req.params.positionId, asset: { userId: req.subjectId } },
    include: { asset: true },
  });
  if (!pos) throw notFound('Producto no encontrado');
  return pos;
}

r.get('/categories', ah(async (_req, res) => res.json(await prisma.assetCategory.findMany({ orderBy: { sortOrder: 'asc' } }))));

r.get('/', validate(periodQuery, 'query'), ah(async (req, res) => {
  const { period, summary } = await getPeriodSummary(req.subjectId, req.validQuery.periodId);
  res.json({ period, portfolio: summary.portfolio, patrimony: summary.patrimony, reconciliation: summary.reconciliation });
}));

r.get('/carry', validate(periodQuery, 'query'), ah(async (req, res) => {
  const period = await getOpenPeriod(req.subjectId, req.validQuery.periodId).catch(() => null);
  res.json(period ? await carryGaps(req.subjectId, period) : []);
}));

r.get('/spend', validate(periodQuery, 'query'), ah(async (req, res) => res.json(await listIncomeUses(req.subjectId, req.validQuery.periodId))));
r.post('/positions/:positionId/spend', validate(incomeSpendSchema), ah(async (req, res) => res.status(201).json(await spendIncome(req, req.params.positionId, req.body))));
r.delete('/spend/:expenseId', ah(async (req, res) => {
  await undoIncomeUse(req, req.params.expenseId);
  res.status(204).end();
}));

r.post('/positions/:positionId/carry', ah(async (req, res) => res.json(await applyCarry(req, req.params.positionId))));

r.get('/assets/:assetId', ah(async (req, res) => {
  const asset = await prisma.asset.findFirst({
    where: { id: req.params.assetId, userId: req.subjectId },
    include: { category: true, positions: { include: { period: true } }, movements: { orderBy: { date: 'asc' } } },
  });
  if (!asset) throw notFound('Producto no encontrado');
  const history = asset.positions
    .map((p) => ({
      positionId: p.id,
      year: p.period.year,
      month: p.period.month,
      status: p.period.status,
      ...capitalResult(p.initialCapital, p.finalCapital),
    }))
    .sort((a, b) => a.year - b.year || a.month - b.month);
  const { positions: _omit, ...rest } = asset;
  res.json({ ...rest, history });
}));

r.post('/positions', validate(assetSchema), ah(async (req, res) => {
  const { periodId, categoryCode, name, institution, notes, initialCapital } = req.body;
  const period = await getOpenPeriod(req.subjectId, periodId);
  const catId = await categoryId(categoryCode);
  const pos = await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({ data: { userId: req.subjectId, categoryId: catId, name, institution, notes, ...incomeFields(req.body, periodStart(period)) } });
    return tx.assetPosition.create({ data: { assetId: asset.id, periodId, initialCapital, ...formIncome(asset, period, req.body) } });
  });
  await applyDueIncome(req.subjectId);
  res.status(201).json(pos);
}));

r.put('/positions/:positionId', validate(assetSchema), ah(async (req, res) => {
  const pos = await ownedPosition(req);
  const period = await getOpenPeriod(req.subjectId, pos.periodId);
  const { categoryCode, name, institution, notes, initialCapital } = req.body;
  const start = sameIncome(pos.asset, req.body) && pos.asset.incomeStart ? pos.asset.incomeStart : periodStart(period);
  const catId = await categoryId(categoryCode);
  const updated = await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.update({ where: { id: pos.assetId }, data: { categoryId: catId, name, institution, notes, ...incomeFields(req.body, start) } });
    const income = formIncome(asset, period, req.body);
    const saved = await tx.assetPosition.update({
      where: { id: pos.id },
      data: { initialCapital, ...income },
      include: { asset: true },
    });
    await carryForward(tx, pos.assetId, period, income.finalCapital - Number(pos.finalCapital));
    return saved;
  });
  await applyDueIncome(req.subjectId);
  res.json(updated);
}));

r.post('/positions/:positionId/assign', ah(async (req, res) => res.json(await assignContribution(req, req.params.positionId, String(req.body?.movementId || '')))));

r.put('/positions/:positionId/income', validate(positionIncomeSchema), ah(async (req, res) => res.json(await setPositionIncome(req, req.params.positionId, req.body))));

r.delete('/positions/:positionId', ah(async (req, res) => {
  const pos = await ownedPosition(req);
  await getOpenPeriod(req.subjectId, pos.periodId);
  await prisma.$transaction(async (tx) => {
    await tx.assetPosition.delete({ where: { id: pos.id } });
    const remaining = await tx.assetPosition.count({ where: { assetId: pos.assetId } });
    if (!remaining) await tx.asset.delete({ where: { id: pos.assetId } });
  });
  res.status(204).end();
}));

export default r;

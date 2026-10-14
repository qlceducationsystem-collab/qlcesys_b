import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { ah } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.js';
import { assetSchema, periodQuery } from '../validations/schemas.js';
import { getOpenPeriod, getPeriodSummary } from '../services/period.service.js';
import { logAdminChange } from '../services/audit.service.js';
import { capitalResult } from '../domain/finance.js';

const r = Router();
const MODULE = 'CARTERA';

async function categoryId(code) {
  const cat = await prisma.assetCategory.findUnique({ where: { code } });
  if (!cat) throw badRequest('Categoría no válida');
  return cat.id;
}

async function ownedPosition(req) {
  const pos = await prisma.assetPosition.findFirst({
    where: { id: req.params.positionId, asset: { userId: req.subjectId } },
    include: { asset: true },
  });
  if (!pos) throw notFound('Producto no encontrado');
  return pos;
}

const flat = (pos) => ({
  name: pos.asset.name,
  institution: pos.asset.institution,
  notes: pos.asset.notes,
  categoryId: pos.asset.categoryId,
  initialCapital: pos.initialCapital,
  finalCapital: pos.finalCapital,
  periodId: pos.periodId,
});

r.get('/categories', ah(async (_req, res) => res.json(await prisma.assetCategory.findMany({ orderBy: { sortOrder: 'asc' } }))));

// Resumen de cartera + patrimonio + conciliación del periodo.
r.get('/', validate(periodQuery, 'query'), ah(async (req, res) => {
  const { period, summary } = await getPeriodSummary(req.subjectId, req.validQuery.periodId);
  res.json({ period, portfolio: summary.portfolio, patrimony: summary.patrimony, reconciliation: summary.reconciliation });
}));

// Detalle histórico de un producto en todos los periodos.
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
  const { periodId, categoryCode, name, institution, notes, initialCapital, finalCapital } = req.body;
  await getOpenPeriod(req.subjectId, periodId);
  const catId = await categoryId(categoryCode);
  const pos = await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({ data: { userId: req.subjectId, categoryId: catId, name, institution, notes } });
    const created = await tx.assetPosition.create({ data: { assetId: asset.id, periodId, initialCapital, finalCapital } });
    await logAdminChange(req, { module: MODULE, action: 'CREATE', entityId: created.id, after: req.body }, tx);
    return created;
  });
  res.status(201).json(pos);
}));

r.put('/positions/:positionId', validate(assetSchema), ah(async (req, res) => {
  const pos = await ownedPosition(req);
  await getOpenPeriod(req.subjectId, pos.periodId);
  const { categoryCode, name, institution, notes, initialCapital, finalCapital } = req.body;
  const catId = await categoryId(categoryCode);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id: pos.assetId }, data: { categoryId: catId, name, institution, notes } });
    const p = await tx.assetPosition.update({
      where: { id: pos.id },
      data: { initialCapital, finalCapital },
      include: { asset: true },
    });
    await logAdminChange(req, { module: MODULE, action: 'UPDATE', entityId: pos.id, before: flat(pos), after: flat(p) }, tx);
    return p;
  });
  res.json(updated);
}));

r.delete('/positions/:positionId', ah(async (req, res) => {
  const pos = await ownedPosition(req);
  await getOpenPeriod(req.subjectId, pos.periodId);
  await prisma.$transaction(async (tx) => {
    await tx.assetPosition.delete({ where: { id: pos.id } });
    // Si el producto ya no existe en ningún periodo, se elimina el maestro.
    const remaining = await tx.assetPosition.count({ where: { assetId: pos.assetId } });
    if (!remaining) await tx.asset.delete({ where: { id: pos.assetId } });
    await logAdminChange(req, { module: MODULE, action: 'DELETE', entityId: pos.id, before: flat(pos) }, tx);
  });
  res.status(204).end();
}));

export default r;

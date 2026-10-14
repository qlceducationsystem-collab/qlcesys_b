import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { ah } from '../utils/asyncHandler.js';
import { notFound } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.js';
import { periodQuery } from '../validations/schemas.js';
import { getOpenPeriod, getOwnedPeriod } from '../services/period.service.js';
import { logAdminChange } from '../services/audit.service.js';

/**
 * CRUD genérico para registros de un usuario dentro de un periodo
 * (ingresos, gastos, protección, movimientos). Garantiza:
 * propiedad del registro, periodo abierto y trazabilidad administrativa.
 */
export function periodCrudRouter({ model, schema, module, beforeWrite, orderBy = { createdAt: 'asc' } }) {
  const r = Router();
  const delegate = () => prisma[model];

  async function findOwned(req) {
    const row = await delegate().findFirst({ where: { id: req.params.id, userId: req.subjectId } });
    if (!row) throw notFound();
    return row;
  }

  r.get('/', validate(periodQuery, 'query'), ah(async (req, res) => {
    await getOwnedPeriod(req.subjectId, req.validQuery.periodId);
    res.json(await delegate().findMany({ where: { userId: req.subjectId, periodId: req.validQuery.periodId }, orderBy }));
  }));

  r.post('/', validate(schema), ah(async (req, res) => {
    await getOpenPeriod(req.subjectId, req.body.periodId);
    if (beforeWrite) await beforeWrite(req);
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx[model].create({ data: { ...req.body, userId: req.subjectId } });
      await logAdminChange(req, { module, action: 'CREATE', entityId: created.id, after: created }, tx);
      return created;
    });
    res.status(201).json(row);
  }));

  r.put('/:id', validate(schema), ah(async (req, res) => {
    const before = await findOwned(req);
    await getOpenPeriod(req.subjectId, before.periodId);
    if (req.body.periodId !== before.periodId) await getOpenPeriod(req.subjectId, req.body.periodId);
    if (beforeWrite) await beforeWrite(req);
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx[model].update({ where: { id: before.id }, data: req.body });
      await logAdminChange(req, { module, action: 'UPDATE', entityId: before.id, before, after: updated }, tx);
      return updated;
    });
    res.json(row);
  }));

  r.delete('/:id', ah(async (req, res) => {
    const before = await findOwned(req);
    await getOpenPeriod(req.subjectId, before.periodId);
    await prisma.$transaction(async (tx) => {
      await tx[model].delete({ where: { id: before.id } });
      await logAdminChange(req, { module, action: 'DELETE', entityId: before.id, before }, tx);
    });
    res.status(204).end();
  }));

  return r;
}

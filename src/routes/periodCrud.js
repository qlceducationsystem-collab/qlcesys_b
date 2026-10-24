import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { ah } from '../utils/asyncHandler.js';
import { notFound } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.js';
import { periodQuery } from '../validations/schemas.js';
import { getOpenPeriod, getOwnedPeriod } from '../services/period.service.js';

export function periodCrudRouter({ model, schema, beforeWrite, orderBy = { createdAt: 'asc' } }) {
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
    res.status(201).json(await delegate().create({ data: { ...req.body, userId: req.subjectId } }));
  }));

  r.put('/:id', validate(schema), ah(async (req, res) => {
    const before = await findOwned(req);
    await getOpenPeriod(req.subjectId, before.periodId);
    if (req.body.periodId !== before.periodId) await getOpenPeriod(req.subjectId, req.body.periodId);
    if (beforeWrite) await beforeWrite(req);
    res.json(await delegate().update({ where: { id: before.id }, data: req.body }));
  }));

  r.delete('/:id', ah(async (req, res) => {
    const before = await findOwned(req);
    await getOpenPeriod(req.subjectId, before.periodId);
    await delegate().delete({ where: { id: before.id } });
    res.status(204).end();
  }));

  return r;
}

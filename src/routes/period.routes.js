import { Router } from 'express';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { requireAdminLevel } from '../middlewares/auth.js';
import { historyQuery, openingSchema, periodSchema } from '../validations/schemas.js';
import * as periods from '../services/period.service.js';
import { closePeriod, reopenPeriod } from '../services/close.service.js';
import { getHistory } from '../services/history.service.js';
import { allocationFromPortfolio } from '../domain/learning.js';
import { patrimonialOverview } from '../services/patrimonialOverview.service.js';

const r = Router();

r.get('/', ah(async (req, res) => res.json(await periods.listPeriods(req.subjectId))));

r.post('/', validate(periodSchema), ah(async (req, res) => {
  const period = await periods.createPeriod(req.subjectId, req.body);
  res.status(201).json(period);
}));

r.get('/history', validate(historyQuery, 'query'), ah(async (req, res) => res.json(await getHistory(req.subjectId, req.validQuery))));

r.get('/:id/summary', ah(async (req, res) => {
  const { period, summary } = await periods.getPeriodSummary(req.subjectId, req.params.id);
  res.json({ period, summary, allocation: allocationFromPortfolio(summary.portfolio.products) });
}));

r.get('/:id/patrimonial', ah(async (req, res) => {
  const { period, summary } = await periods.getPeriodSummary(req.subjectId, req.params.id);
  res.json(await patrimonialOverview(req.subjectId, period, summary));
}));

r.patch('/:id/opening', validate(openingSchema), ah(async (req, res) => {
  res.json(await periods.updateOpening(req.subjectId, req.params.id, req.body.openingNetWorth));
}));

r.post('/:id/close', ah(async (req, res) => res.status(201).json(await closePeriod(req, req.params.id))));

r.post('/:id/reopen', requireAdminLevel('FULL'), ah(async (req, res) => res.json(await reopenPeriod(req, req.params.id))));

export default r;

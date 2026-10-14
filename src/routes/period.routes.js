import { Router } from 'express';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { requireAdminLevel } from '../middlewares/auth.js';
import { historyQuery, openingSchema, periodSchema, reasonSchema } from '../validations/schemas.js';
import * as periods from '../services/period.service.js';
import { closePeriod, reopenPeriod } from '../services/close.service.js';
import { getHistory } from '../services/history.service.js';
import { logAdminChange } from '../services/audit.service.js';

const r = Router();

r.get('/', ah(async (req, res) => res.json(await periods.listPeriods(req.subjectId))));

r.post('/', validate(periodSchema), ah(async (req, res) => {
  const period = await periods.createPeriod(req.subjectId, req.body);
  await logAdminChange(req, { module: 'PERIODOS', action: 'CREATE', entityId: period.id, after: req.body });
  res.status(201).json(period);
}));

// Evolución mensual (cerrados → snapshot, abiertos → cálculo vivo).
r.get('/history', validate(historyQuery, 'query'), ah(async (req, res) => res.json(await getHistory(req.subjectId, req.validQuery))));

// Resumen completo del periodo: fuente única para todas las pantallas.
r.get('/:id/summary', ah(async (req, res) => {
  const { period, summary } = await periods.getPeriodSummary(req.subjectId, req.params.id);
  res.json({ period, summary });
}));

r.patch('/:id/opening', validate(openingSchema), ah(async (req, res) => {
  const before = await periods.getOwnedPeriod(req.subjectId, req.params.id);
  const updated = await periods.updateOpening(req.subjectId, req.params.id, req.body.openingNetWorth);
  await logAdminChange(req, {
    module: 'PATRIMONIO', action: 'UPDATE', entityId: updated.id,
    before: { openingNetWorth: before.openingNetWorth }, after: { openingNetWorth: updated.openingNetWorth },
  });
  res.json(updated);
}));

r.post('/:id/close', ah(async (req, res) => res.status(201).json(await closePeriod(req, req.params.id))));

// Reapertura (corrección administrativa): solo administración completa y con motivo.
r.post('/:id/reopen', requireAdminLevel('FULL'), validate(reasonSchema), ah(async (req, res) => {
  res.json(await reopenPeriod(req, req.params.id, req.body.reason));
}));

export default r;

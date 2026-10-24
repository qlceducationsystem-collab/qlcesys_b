import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import {
  diagnosisSchema, marketFilterSchema, moduleProgressSchema, productSchema, routeSchema, simulationSchemas,
} from '../validations/schemas.js';
import * as academy from '../services/academy.service.js';
import * as moduleData from '../services/moduleData.service.js';
import { createMediaLink } from '../services/moduleMedia.service.js';

const r = Router();
const moduleNumber = (req) => z.coerce.number().int().min(1).max(12).parse(req.params.n);

r.get('/', ah(async (req, res) => {
  res.json(await academy.academyOverview(req));
}));

r.get('/modules/:n', ah(async (req, res) => res.json(await academy.getModule(req, moduleNumber(req)))));

r.put('/modules/:n/progress', validate(moduleProgressSchema), ah(async (req, res) => {
  const n = moduleNumber(req);
  const snapshot = req.body.status === 'COMPLETED' && n === 3 ? (await moduleData.currentAllocation(req.subjectId)).allocation : undefined;
  res.json(await academy.saveProgress(req, n, { ...req.body, snapshot }));
}));

r.get('/modules/:n/simulations', ah(async (req, res) => {
  const n = moduleNumber(req);
  await academy.assertToolOpen(req, n);
  res.json(await academy.listSimulations(req.subjectId, n));
}));

r.post('/modules/:n/simulate', ah(async (req, res) => {
  const n = moduleNumber(req);
  const schema = simulationSchemas[n];
  if (!schema) return res.status(404).json({ error: 'Este módulo no tiene simulador' });
  await academy.assertToolOpen(req, n);
  res.json(await academy.runSimulation(req, n, schema.parse(req.body?.input || {}), !!req.body?.save));
}));

r.get('/media/:id/link', ah(async (req, res) => res.json(await createMediaLink(req, req.params.id))));

r.get('/diagnosis', ah(async (req, res) => {
  await academy.assertToolOpen(req, 1);
  res.json(await moduleData.getDiagnosis(req.subjectId));
}));

r.put('/diagnosis', validate(diagnosisSchema), ah(async (req, res) => {
  await academy.assertToolOpen(req, 1);
  const saved = await moduleData.saveDiagnosis(req, req.body);
  await academy.saveProgress(req, 1, { status: 'IN_PROGRESS' });
  res.json(saved);
}));

r.get('/products', ah(async (req, res) => {
  await academy.assertToolOpen(req, 2);
  res.json(await moduleData.listProducts(req.subjectId));
}));

r.post('/products', validate(productSchema), ah(async (req, res) => {
  await academy.assertToolOpen(req, 2);
  res.status(201).json(await moduleData.addProduct(req, req.body));
}));

r.put('/products/:assetId', validate(productSchema), ah(async (req, res) => {
  await academy.assertToolOpen(req, 2);
  res.json(await moduleData.updateProduct(req, req.params.assetId, req.body));
}));

r.delete('/products/:assetId', ah(async (req, res) => {
  await academy.assertToolOpen(req, 2);
  await moduleData.deleteProduct(req, req.params.assetId);
  res.status(204).end();
}));

r.get('/allocation', ah(async (req, res) => {
  await academy.assertToolOpen(req, 3);
  res.json(await moduleData.currentAllocation(req.subjectId));
}));

r.put('/route', validate(routeSchema), ah(async (req, res) => res.json(await academy.chooseRoute(req, req.body.route))));

r.post('/market-filter', validate(marketFilterSchema), ah(async (req, res) => res.json(await academy.submitMarketFilter(req, req.body.answers))));

export default r;

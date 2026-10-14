import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../utils/asyncHandler.js';
import { badRequest } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.js';
import { progressSchema, toolSchemas } from '../validations/schemas.js';
import { TOOLS } from '../domain/tools.js';
import * as academy from '../services/academy.service.js';
import { logAdminChange } from '../services/audit.service.js';

const r = Router();
const month = (req) => z.coerce.number().int().min(1).max(12).parse(req.params.month);

r.get('/', ah(async (req, res) => res.json(await academy.listModules(req.subjectId))));
r.get('/modules/:month', ah(async (req, res) => res.json(await academy.getModule(req, month(req)))));

r.put('/modules/:month/progress', validate(progressSchema), ah(async (req, res) => {
  const { before, row } = await academy.saveProgress(req, month(req), req.body);
  await logAdminChange(req, { module: 'ACADEMIA', action: before ? 'UPDATE' : 'CREATE', entityId: row.id, before, after: row });
  res.json(row);
}));

// Herramientas de cálculo (Mes 10 y 11). Con save=true guarda el resultado como registro del módulo.
r.post('/tools/:tool', ah(async (req, res) => {
  const { tool } = req.params;
  if (!TOOLS[tool]) throw badRequest('Herramienta no válida');
  await academy.assertUnlocked(req, academy.TOOL_MODULE[tool]);
  const input = toolSchemas[tool].parse(req.body?.input || {});
  const result = TOOLS[tool](input);
  if (req.body?.save) {
    const current = await academy.getModule(req, academy.TOOL_MODULE[tool]).catch(() => null);
    const status = current?.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS';
    const { row } = await academy.saveProgress(req, academy.TOOL_MODULE[tool], { status, toolData: { tool, input, result, savedAt: new Date() } });
    await logAdminChange(req, { module: 'HERRAMIENTAS', action: 'CREATE', entityId: row.id, after: { tool, input } });
  }
  res.json({ input, result });
}));

export default r;

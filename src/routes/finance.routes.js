import { prisma } from '../config/prisma.js';
import { badRequest } from '../utils/httpError.js';
import { absorbExpenseChange } from '../services/moduleData.service.js';
import { releaseDebtPayment } from '../services/debt.service.js';
import { periodCrudRouter } from './periodCrud.js';
import { onExpenseWrite, onMovementWrite } from '../services/incomeUse.service.js';
import { ah } from '../utils/asyncHandler.js';
import { policyUpload } from '../middlewares/upload.js';
import { attachPolicy, policyUrl, removePolicy } from '../services/policy.service.js';
import { expenseSchema, incomeSchema, movementSchema, protectionSchema } from '../validations/schemas.js';

export const incomesRouter = periodCrudRouter({ model: 'income', schema: incomeSchema });
export const expensesRouter = periodCrudRouter({
  model: 'expense',
  schema: expenseSchema,
  afterWrite: async (tx, req, before, after) => {
    await onExpenseWrite(tx, before, after);
    await absorbExpenseChange(tx, req.subjectId, before, after);
    if (before && !after && before.source === 'M9_PAYMENT') await releaseDebtPayment(tx, before.id);
  },
});
export const protectionRouter = periodCrudRouter({ model: 'protectionRecord', schema: protectionSchema });

protectionRouter.post('/:id/policy', policyUpload, ah(async (req, res) => res.json(await attachPolicy(req, req.params.id, req.file))));
protectionRouter.get('/:id/policy', ah(async (req, res) => res.json({ url: await policyUrl(req, req.params.id) })));
protectionRouter.delete('/:id/policy', ah(async (req, res) => res.json(await removePolicy(req, req.params.id))));

export const movementsRouter = periodCrudRouter({
  model: 'patrimonialMovement',
  schema: movementSchema,
  orderBy: { date: 'asc' },
  afterWrite: (tx, _req, before, after) => onMovementWrite(tx, before, after),
  beforeWrite: async (req) => {
    if (!req.body.assetId) return;
    const asset = await prisma.asset.findFirst({ where: { id: req.body.assetId, userId: req.subjectId } });
    if (!asset) throw badRequest('Producto no válido');
  },
});

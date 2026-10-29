import { prisma } from '../config/prisma.js';
import { badRequest } from '../utils/httpError.js';
import { absorbExpenseChange } from '../services/moduleData.service.js';
import { releaseDebtPayment } from '../services/debt.service.js';
import { periodCrudRouter } from './periodCrud.js';
import { expenseSchema, incomeSchema, movementSchema, protectionSchema } from '../validations/schemas.js';

export const incomesRouter = periodCrudRouter({ model: 'income', schema: incomeSchema });
export const expensesRouter = periodCrudRouter({
  model: 'expense',
  schema: expenseSchema,
  afterWrite: async (tx, req, before, after) => {
    await absorbExpenseChange(tx, req.subjectId, before, after);
    if (before && !after && before.source === 'M9_PAYMENT') await releaseDebtPayment(tx, before.id);
  },
});
export const protectionRouter = periodCrudRouter({ model: 'protectionRecord', schema: protectionSchema });

export const movementsRouter = periodCrudRouter({
  model: 'patrimonialMovement',
  schema: movementSchema,
  orderBy: { date: 'asc' },
  beforeWrite: async (req) => {
    if (!req.body.assetId) return;
    const asset = await prisma.asset.findFirst({ where: { id: req.body.assetId, userId: req.subjectId } });
    if (!asset) throw badRequest('Producto no válido');
  },
});

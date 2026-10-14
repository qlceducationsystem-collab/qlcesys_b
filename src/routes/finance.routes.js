// Registros financieros por periodo basados en el CRUD genérico.
import { prisma } from '../config/prisma.js';
import { badRequest } from '../utils/httpError.js';
import { periodCrudRouter } from './periodCrud.js';
import { expenseSchema, incomeSchema, movementSchema, protectionSchema } from '../validations/schemas.js';

export const incomesRouter = periodCrudRouter({ model: 'income', schema: incomeSchema, module: 'INGRESOS' });
export const expensesRouter = periodCrudRouter({ model: 'expense', schema: expenseSchema, module: 'GASTOS' });
export const protectionRouter = periodCrudRouter({ model: 'protectionRecord', schema: protectionSchema, module: 'PROTECCION' });

export const movementsRouter = periodCrudRouter({
  model: 'patrimonialMovement',
  schema: movementSchema,
  module: 'MOVIMIENTOS',
  orderBy: { date: 'asc' },
  // El producto asociado (opcional) debe pertenecer al mismo usuario.
  beforeWrite: async (req) => {
    if (!req.body.assetId) return;
    const asset = await prisma.asset.findFirst({ where: { id: req.body.assetId, userId: req.subjectId } });
    if (!asset) throw badRequest('Producto no válido');
  },
});

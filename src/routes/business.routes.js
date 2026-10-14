// Negocios y flujo: flujo operativo mensual de los negocios registrados en Mi cartera.
import { prisma } from '../config/prisma.js';
import { badRequest } from '../utils/httpError.js';
import { periodCrudRouter } from './periodCrud.js';
import { businessFlowSchema } from '../validations/schemas.js';

export const businessRouter = periodCrudRouter({
  model: 'businessFlow',
  schema: businessFlowSchema,
  module: 'NEGOCIOS',
  beforeWrite: async (req) => {
    const asset = await prisma.asset.findFirst({
      where: { id: req.body.assetId, userId: req.subjectId, category: { code: 'NEGOCIOS' } },
    });
    if (!asset) throw badRequest('Selecciona un negocio registrado en Mi cartera');
  },
});

// Panel administrativo (sin cliente seleccionado). Para operar sobre los datos
// del cliente se usan las rutas privadas normales con el header X-Client-Id.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { ah } from '../utils/asyncHandler.js';
import { notFound } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.js';
import { requireAdminLevel } from '../middlewares/auth.js';
import {
  adminLevelSchema, adminSubscriptionSchema, adminUserSchema, appointmentAdminSchema, createAdminSchema,
} from '../validations/schemas.js';
import * as admin from '../services/admin.service.js';
import { logAdminChange } from '../services/audit.service.js';

const r = Router();
const FULL = requireAdminLevel('FULL');
const EDIT = requireAdminLevel('EDIT');
const auditQuery = z.object({ clientId: z.string().max(40).optional(), page: z.coerce.number().int().min(1).default(1) });
const statusQuery = z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).optional();

r.get('/stats', ah(async (_req, res) => res.json(await admin.stats())));
r.get('/clients', ah(async (req, res) => res.json(await admin.listClients({ q: req.query.q }))));
r.get('/clients/:id', ah(async (req, res) => res.json(await admin.getClient(req.params.id))));
r.patch('/clients/:id/subscription', FULL, validate(adminSubscriptionSchema), ah(async (req, res) => {
  res.json(await admin.setSubscriptionStatus(req, req.params.id, req.body));
}));
r.patch('/clients/:id/status', FULL, validate(adminUserSchema), ah(async (req, res) => {
  res.json(await admin.setClientActive(req, req.params.id, req.body));
}));

r.get('/audit', ah(async (req, res) => res.json(await admin.listAudit(auditQuery.parse(req.query)))));

r.get('/appointments', ah(async (req, res) => {
  const status = statusQuery.parse(req.query.status || undefined);
  res.json(await prisma.appointment.findMany({
    where: status ? { status } : {},
    orderBy: { scheduledAt: 'asc' },
    include: { user: { select: { id: true, name: true, email: true, phone: true } } },
    take: 300,
  }));
}));

r.patch('/appointments/:id', EDIT, validate(appointmentAdminSchema), ah(async (req, res) => {
  const before = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound('Cita no encontrada');
  const after = await prisma.appointment.update({ where: { id: before.id }, data: req.body });
  await logAdminChange(req, { module: 'ASESORIA', action: 'UPDATE', entityId: before.id, before, after, clientId: before.userId });
  res.json(after);
}));

r.get('/admins', FULL, ah(async (_req, res) => res.json(await admin.listAdmins())));
r.post('/admins', FULL, validate(createAdminSchema), ah(async (req, res) => res.status(201).json(await admin.createAdmin(req.body))));
r.patch('/admins/:id/level', FULL, validate(adminLevelSchema), ah(async (req, res) => {
  res.json(await admin.setAdminLevel(req, req.params.id, req.body));
}));

export default r;

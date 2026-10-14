import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ah } from '../utils/asyncHandler.js';
import { notFound } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.js';
import { requireAdminLevel } from '../middlewares/auth.js';
import { imageUpload, moduleFileUpload } from '../middlewares/upload.js';
import {
  adminLevelSchema, adminUserSchema, appointmentAdminSchema, createAdminSchema, grantSchema, mediaUpdateSchema,
  offerUpdateSchema, publicSectionSchema, reasonSchema, reorderSchema,
} from '../validations/schemas.js';
import * as admin from '../services/admin.service.js';
import * as cms from '../services/publicContent.service.js';
import * as media from '../services/moduleMedia.service.js';
import * as google from '../services/google/oauth.js';
import { listOffers } from '../services/access.service.js';
import { listAllAttempts } from '../services/payments/payment.service.js';
import { platformMetrics } from '../services/analytics.service.js';
import { sendEmail } from '../services/email.service.js';
import { logAdminChange } from '../services/audit.service.js';
import { resetTwoFactor } from '../services/auth.service.js';

const r = Router();
const FULL = requireAdminLevel('FULL');
const EDIT = requireAdminLevel('EDIT');
const auditQuery = z.object({ clientId: z.string().max(40).optional(), page: z.coerce.number().int().min(1).default(1) });
const appointmentStatus = z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).optional();
const attemptStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional();
const service = (req) => z.enum(['DRIVE', 'GMAIL']).parse(String(req.params.service).toUpperCase());
const moduleParam = z.coerce.number().int().min(1).max(12);

r.get('/analytics', ah(async (req, res) => res.json(await platformMetrics({ days: z.coerce.number().int().min(7).max(90).default(30).parse(req.query.days) }))));

r.get('/clients', ah(async (req, res) => res.json(await admin.listClients({ q: req.query.q }))));
r.get('/clients/:id', ah(async (req, res) => res.json(await admin.getClient(req.params.id))));
r.post('/clients/:id/grants', FULL, validate(grantSchema), ah(async (req, res) => res.status(201).json(await admin.grantAccess(req, req.params.id, req.body))));
r.post('/clients/:id/grants/:grantId/revoke', FULL, validate(reasonSchema), ah(async (req, res) => {
  await admin.revokeGrant(req, req.params.id, req.params.grantId, req.body.reason);
  res.json({ ok: true });
}));
r.patch('/clients/:id/status', FULL, validate(adminUserSchema), ah(async (req, res) => res.json(await admin.setClientActive(req, req.params.id, req.body))));
r.post('/clients/:id/reset-2fa', FULL, validate(reasonSchema), ah(async (req, res) => {
  await resetTwoFactor(req, req.params.id, req.body.reason);
  res.json({ ok: true });
}));

r.get('/audit', ah(async (req, res) => res.json(await admin.listAudit(auditQuery.parse(req.query)))));

r.get('/appointments', ah(async (req, res) => {
  const status = appointmentStatus.parse(req.query.status || undefined);
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

r.get('/pricing', ah(async (_req, res) => res.json(await listOffers({ includeInactive: true }))));
r.put('/pricing/:code', FULL, validate(offerUpdateSchema), ah(async (req, res) => res.json(await admin.updateOffer(req.user.id, req.params.code, req.body))));
r.get('/payments', ah(async (req, res) => res.json(await listAllAttempts({ status: attemptStatus.parse(req.query.status || undefined) }))));

r.get('/public-content', ah(async (_req, res) => res.json(await cms.listSections({ includeInactive: true }))));
r.put('/public-content/order', EDIT, validate(reorderSchema), ah(async (req, res) => res.json(await cms.reorderSections(req.body.keys))));
r.put('/public-content/:key', EDIT, validate(publicSectionSchema), ah(async (req, res) => res.json(await cms.updateSection(req.user.id, req.params.key, req.body))));
r.post('/public-content/:key/image', EDIT, imageUpload, ah(async (req, res) => res.json(await cms.replaceSectionImage(req.user.id, req.params.key, req.file))));
r.delete('/public-content/:key/image', EDIT, ah(async (req, res) => res.json(await cms.removeSectionImage(req.user.id, req.params.key))));

r.get('/module-media', ah(async (req, res) => res.json(await media.listModuleMedia(req.query.module ? moduleParam.parse(req.query.module) : undefined))));
r.post('/module-media', EDIT, moduleFileUpload, ah(async (req, res) => {
  const moduleNumber = moduleParam.parse(req.body.moduleNumber);
  res.status(201).json(await media.uploadModuleMedia({ moduleNumber, file: req.file, adminId: req.user.id }));
}));
r.patch('/module-media/:id', EDIT, validate(mediaUpdateSchema), ah(async (req, res) => res.json(await media.updateModuleMedia(req.params.id, req.body))));
r.delete('/module-media/:id', EDIT, ah(async (req, res) => {
  await media.deleteModuleMedia(req.params.id);
  res.status(204).end();
}));
r.get('/module-media/:id/link', ah(async (req, res) => res.json(await media.createMediaLink(req, req.params.id))));

r.get('/integrations', ah(async (_req, res) => {
  const [items, emails] = await Promise.all([
    google.integrationStatus(),
    prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, to: true, subject: true, template: true, status: true, error: true, createdAt: true } }),
  ]);
  res.json({ items, emails, redirectUri: env.google.redirectUri });
}));
r.get('/integrations/:service/connect', FULL, ah(async (req, res) => res.json({ url: google.buildAuthUrl(service(req), req.user.id) })));
r.delete('/integrations/:service', FULL, ah(async (req, res) => {
  await google.disconnect(service(req));
  res.json(await google.integrationStatus());
}));
r.post('/integrations/gmail/test', FULL, ah(async (req, res) => res.json(await sendEmail('test', req.user.email, { name: req.user.name }))));

r.get('/admins', FULL, ah(async (_req, res) => res.json(await admin.listAdmins())));
r.post('/admins', FULL, validate(createAdminSchema), ah(async (req, res) => res.status(201).json(await admin.createAdmin(req.user.id, req.body))));
r.patch('/admins/:id/level', FULL, validate(adminLevelSchema), ah(async (req, res) => res.json(await admin.setAdminLevel(req, req.params.id, req.body))));

export default r;

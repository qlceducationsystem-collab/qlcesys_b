import { bitgetSettingsView, saveBitgetSettings, WALLET_NETWORKS } from '../services/payments/bitgetSettings.service.js';
import * as bitget from '../services/payments/bitgetReport.service.js';
import { paymentSettingsView, savePaymentSettings, testMercadoPagoConnection } from '../services/payments/paymentSettings.service.js';
import { COUNTRY_CODES } from '../shared/countries.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ah } from '../utils/asyncHandler.js';
import { notFound } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.js';
import { requireAdminLevel } from '../middlewares/auth.js';
import { moduleFileUpload } from '../middlewares/upload.js';
import {
  adminLevelSchema, adminPasswordSchema, adminUserSchema, appointmentAdminSchema, createAdminSchema, mediaUpdateSchema,
  authorizePromoSchema, expirySchema, giftSettingsSchema, manualGrantSchema, masterChangeSchema, masterSetupSchema, promotionSchema, revokeSchema,
  exerciseQuery, exerciseReplySchema, leadQuery, leadUpdateSchema, loginNoticeSchema, offerUpdateSchema,
} from '../validations/schemas.js';
import * as admin from '../services/admin.service.js';
import * as media from '../services/moduleMedia.service.js';
import * as google from '../services/google/oauth.js';
import { driveSettingsView, testDriveConnection } from '../services/google/driveSettings.service.js';
import { listOffers } from '../services/access.service.js';
import { listAllAttempts } from '../services/payments/payment.service.js';
import { platformMetrics } from '../services/analytics.service.js';
import { sendEmail } from '../services/email.service.js';
import { resetTwoFactor } from '../services/auth.service.js';
import * as leads from '../services/lead.service.js';
import { getLoginNotice, saveLoginNotice } from '../services/loginNotice.service.js';
import * as exercises from '../services/exerciseInbox.service.js';
import { adminMessages, adminSend, stopShareByAdmin } from '../services/dataShare.service.js';
import { EVENT_GROUPS, listEvents, actorOf, recordEvent } from '../services/adminEvent.service.js';
import { CLIENT_EMAIL_GROUPS, mailSettingsView, recordMailTest, saveMailSettings } from '../services/mailSettings.service.js';
import { resetEmailReady, sendClientEmail } from '../services/email.service.js';
import { adminQuestions, answerQuestion, releaseCredits } from '../services/credit.service.js';
import { masterclassSettings, saveMasterclassSettings } from '../services/masterclass.service.js';
import { listSubscribers, retentionSettings, saveRetentionSettings } from '../services/subscriber.service.js';
import * as promotions from '../services/promotion.service.js';
import * as gifts from '../services/gift.service.js';
import * as master from '../services/master.service.js';
import * as accessControl from '../services/accessControl.service.js';

const r = Router();
const FULL = requireAdminLevel('FULL');
const EDIT = requireAdminLevel('EDIT');
const appointmentStatus = z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).optional();
const attemptStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional();
const service = (req) => z.enum(['DRIVE', 'GMAIL']).parse(String(req.params.service).toUpperCase());
const moduleParam = z.coerce.number().int().min(1).max(12);

r.get('/analytics', ah(async (req, res) => res.json(await platformMetrics({ days: z.coerce.number().int().min(7).max(90).default(30).parse(req.query.days) }))));

r.get('/clients', ah(async (req, res) => res.json(await admin.listClients({ q: req.query.q }))));
r.get('/clients/:id', ah(async (req, res) => res.json(await admin.getClient(req.params.id))));
r.get('/clients/:id/data-share/messages', ah(async (req, res) => res.json(await adminMessages(req.params.id))));
r.post('/clients/:id/data-share/messages', ah(async (req, res) => res.status(201).json(await adminSend(req.user, req.params.id, req.body?.body))));
r.post('/clients/:id/data-share/stop', ah(async (req, res) => res.json(await stopShareByAdmin(req.user, req.params.id))));

r.get('/subscribers', ah(async (req, res) => res.json(await listSubscribers({ state: req.query.state, q: req.query.q }))));
r.get('/events', ah(async (req, res) => res.json(await listEvents({ category: req.query.category, userId: req.query.userId, type: req.query.type, take: req.query.take }))));

r.get('/promotions', ah(async (req, res) => res.json(await promotions.listPromotions({ userId: req.query.userId }))));
r.post('/promotions', EDIT, validate(promotionSchema), ah(async (req, res) => res.status(201).json(await promotions.createPromotion(req.user, req.body))));
r.post('/promotions/:id/send', EDIT, ah(async (req, res) => res.json(await promotions.sendPromotion(req.user, req.params.id))));
r.post('/promotions/:id/cancel', EDIT, ah(async (req, res) => res.json(await promotions.cancelPromotion(req.user, req.params.id))));

r.get('/gifts', ah(async (req, res) => res.json(await gifts.listGifts({ status: req.query.status }))));
r.get('/retention', ah(async (_req, res) => res.json(await retentionSettings())));
r.put('/retention', FULL, validate(z.object({ enabled: z.boolean() })), ah(async (req, res) => res.json(await saveRetentionSettings(req.body))));
r.get('/questions', ah(async (req, res) => res.json(await adminQuestions({ status: req.query.status }))));
r.patch('/questions/:id', EDIT, ah(async (req, res) => res.json(await answerQuestion(req.user, req.params.id, req.body?.answer))));
r.get('/masterclass/settings', ah(async (_req, res) => res.json(await masterclassSettings())));
r.put('/masterclass/settings', FULL, validate(z.object({ includedWithFull: z.boolean() })), ah(async (req, res) => res.json(await saveMasterclassSettings(req.body))));
r.get('/gifts/settings', ah(async (_req, res) => res.json(await gifts.giftSettings())));
r.put('/gifts/settings', FULL, validate(giftSettingsSchema), ah(async (req, res) => res.json(await gifts.saveGiftSettings(req.body))));
r.post('/gifts/:id/cancel', FULL, ah(async (req, res) => res.json(await gifts.cancelGift(req.user, req.params.id))));

r.get('/general/status', ah(async (req, res) => res.json(await master.masterStatus(req.user))));
r.post('/general/setup', FULL, validate(masterSetupSchema), ah(async (req, res) => res.json(await master.setupMaster(req.user, req.body))));
r.post('/general/change', FULL, validate(masterChangeSchema), ah(async (req, res) => res.json(await master.changeMaster(req.user, req.body))));
r.get('/general/users', FULL, ah(async (req, res) => res.json(await accessControl.searchUsers(req.query.q))));
r.get('/general/pending', FULL, ah(async (_req, res) => res.json(await accessControl.pendingAuthorizations())));
r.post('/general/grants', FULL, validate(manualGrantSchema), ah(async (req, res) => res.status(201).json(await accessControl.grantManual(req.user, req.body))));
r.put('/general/grants/:id', FULL, validate(expirySchema), ah(async (req, res) => res.json(await accessControl.changeExpiry(req.user, req.params.id, req.body))));
r.post('/general/grants/:id/revoke', FULL, validate(revokeSchema), ah(async (req, res) => res.json(await accessControl.revokeManual(req.user, req.params.id, req.body))));
r.post('/general/pending/:id/authorize', FULL, validate(authorizePromoSchema), ah(async (req, res) => res.json(await accessControl.authorizePromo(req.user, req.params.id, req.body))));
r.post('/general/pending/:id/reject', FULL, validate(revokeSchema), ah(async (req, res) => res.json(await accessControl.rejectPromo(req.user, req.params.id, req.body))));
r.patch('/clients/:id/status', FULL, validate(adminUserSchema), ah(async (req, res) => res.json(await admin.setClientActive(req.params.id, req.body))));
r.patch('/clients/:id/residence-country', EDIT, validate(z.object({ residenceCountry: z.enum(COUNTRY_CODES) })), ah(async (req, res) => res.json(await admin.setClientResidenceCountry(req.user, req.params.id, req.body.residenceCountry))));
r.get('/leads', validate(leadQuery, 'query'), ah(async (req, res) => res.json(await leads.listLeads(req.validQuery))));
r.patch('/leads/:id', requireAdminLevel('EDIT'), validate(leadUpdateSchema), ah(async (req, res) => res.json(await leads.updateLead(req.params.id, req.body))));
r.get('/login-notice', ah(async (_req, res) => res.json(await getLoginNotice())));
r.put('/login-notice', EDIT, validate(loginNoticeSchema), ah(async (req, res) => res.json(await saveLoginNotice(req.user.id, req.body))));
r.get('/exercises', validate(exerciseQuery, 'query'), ah(async (req, res) => res.json(await exercises.listExercises(req.validQuery))));
r.patch('/exercises/:id', EDIT, validate(exerciseReplySchema), ah(async (req, res) => res.json(await exercises.replyExercise(req.params.id, req.body))));

r.post('/clients/:id/reset-2fa', FULL, ah(async (req, res) => {
  await resetTwoFactor(req.params.id);
  res.json({ ok: true });
}));

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
  const appointment = await prisma.appointment.update({ where: { id: req.params.id }, data: req.body }).catch((err) => {
    if (err.code === 'P2025') throw notFound('Cita no encontrada');
    throw err;
  });
  if (req.body.status === 'CANCELLED') await releaseCredits(prisma, appointment.id);
  if ((req.body.status && req.body.status !== 'COMPLETED') || req.body.scheduledAt) {
    const owner = await prisma.user.findUnique({ where: { id: appointment.userId }, select: { name: true, email: true } });
    const status = req.body.scheduledAt && !req.body.status ? 'RESCHEDULED' : appointment.status;
    if (owner) sendClientEmail('CITA_ACTUALIZADA', 'appointmentUpdate', owner.email, { name: owner.name, status, scheduledAt: appointment.scheduledAt }).catch(() => null);
  }
  res.json(appointment);
}));

r.get('/pricing', ah(async (_req, res) => res.json(await listOffers({ includeInactive: true }))));
r.put('/pricing/:code', FULL, validate(offerUpdateSchema), ah(async (req, res) => res.json(await admin.updateOffer(req.params.code, req.body))));
r.get('/payments', ah(async (req, res) => res.json(await listAllAttempts({ status: attemptStatus.parse(req.query.status || undefined) }))));


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

const mailSettingsSchema = z.object({
  clientId: z.string().trim().max(200).regex(/^[\w-]+\.apps\.googleusercontent\.com$/, 'El Client ID no es válido: debe terminar en .apps.googleusercontent.com. Revisa que el navegador no haya escrito tu correo en ese campo.').optional(),
  clientSecret: z.string().trim().max(200).optional(),
  senderName: z.string().trim().min(1).max(120).optional(),
  disabled: z.array(z.string().max(60)).max(100).optional(),
  clientDisabled: z.array(z.string().max(60)).max(100).optional(),
  method: z.enum(['OAUTH', 'SMTP']).optional(),
  smtpEmail: z.union([z.literal(''), z.string().trim().toLowerCase().email('Correo no válido')]).optional(),
  smtpPassword: z.string().trim().max(100).optional(),
});
const paymentSettingsSchema = z.object({
  accessToken: z.string().trim().max(300).optional(),
  webhookSecret: z.string().trim().max(300).optional(),
  testPayerEmail: z.union([z.literal(''), z.string().trim().toLowerCase().email('Correo no válido').max(160)]).optional(),
  enabled: z.boolean().optional(),
});
r.get('/payment-settings', FULL, ah(async (_req, res) => res.json(await paymentSettingsView())));
r.put('/payment-settings', FULL, validate(paymentSettingsSchema), ah(async (req, res) => {
  const view = await savePaymentSettings(req.body);
  if (req.body.accessToken || req.body.webhookSecret || req.body.enabled !== undefined) {
    await recordEvent({ category: 'PLATAFORMA', type: 'PASARELA_CONFIGURADA', actor: actorOf(req.user), status: view.enabled ? 'Mercado Pago activo' : 'Mercado Pago desactivado', result: 'Configuración de Mercado Pago modificada' });
  }
  res.json(view);
}));
r.post('/payment-settings/test', FULL, ah(async (_req, res) => res.json(await testMercadoPagoConnection())));
const bitgetSettingsSchema = z.object({
  uid: z.union([z.literal(''), z.string().trim().regex(/^\d{4,20}$/, 'El UID de Bitget tiene solo números')]).optional(),
  instructions: z.string().trim().max(1500).optional(),
  walletAddress: z.string().trim().max(128).optional(),
  walletNetwork: z.union([z.literal(''), z.enum(Object.keys(WALLET_NETWORKS))]).optional(),
  rates: z.record(z.string().trim().min(3).max(6), z.coerce.number().positive().max(1000000)).optional(),
  enabled: z.boolean().optional(),
});
r.get('/bitget-settings', FULL, ah(async (_req, res) => res.json(await bitgetSettingsView())));
r.put('/bitget-settings', FULL, validate(bitgetSettingsSchema), ah(async (req, res) => {
  const view = await saveBitgetSettings(req.body);
  if (req.body.uid !== undefined || req.body.walletAddress !== undefined || req.body.walletNetwork !== undefined || req.body.enabled !== undefined) {
    await recordEvent({ category: 'PLATAFORMA', type: 'PASARELA_CONFIGURADA', actor: actorOf(req.user), status: view.enabled ? 'Bitget activo' : 'Bitget desactivado', result: 'Configuración de transferencia Bitget modificada' });
  }
  res.json(view);
}));
const reportStatus = z.enum(['PENDING', 'REVIEW', 'CONFIRMED', 'REJECTED']).optional();
r.get('/bitget-reports', ah(async (req, res) => res.json(await bitget.adminReports({ status: reportStatus.parse(req.query.status || undefined) }))));
r.post('/bitget-reports/:id/received', EDIT, ah(async (req, res) => res.json(await bitget.markReceived(req.user, req.params.id))));
r.post('/bitget-reports/:id/confirm', FULL, ah(async (req, res) => res.json(await bitget.confirmReport(req.user, req.params.id))));
r.post('/bitget-reports/:id/reject', EDIT, validate(z.object({ reason: z.string().trim().max(500).optional() })), ah(async (req, res) => res.json(await bitget.rejectReport(req.user, req.params.id, req.body.reason))));
r.post('/bitget-reports/:id/hide', EDIT, ah(async (req, res) => res.json(await bitget.hideReport(req.user, req.params.id))));
r.delete('/bitget-reports/:id', FULL, ah(async (req, res) => res.json(await bitget.deleteReport(req.user, req.params.id))));
r.get('/bitget-files/:id', ah(async (req, res) => bitget.streamEvidence(req.user, req.params.id, req.headers.range, res)));
r.get('/mail-settings', ah(async (_req, res) => res.json({ ...(await mailSettingsView()), groups: EVENT_GROUPS, clientGroups: CLIENT_EMAIL_GROUPS })));
r.put('/mail-settings', FULL, validate(mailSettingsSchema), ah(async (req, res) => {
  const view = await saveMailSettings(req.body);
  resetEmailReady();
  res.json({ ...view, groups: EVENT_GROUPS, clientGroups: CLIENT_EMAIL_GROUPS });
}));

r.get('/integrations', ah(async (_req, res) => {
  const [items, emails] = await Promise.all([
    google.integrationStatus(),
    prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, to: true, subject: true, template: true, status: true, error: true, createdAt: true } }),
  ]);
  res.json({ items, emails, redirectUri: env.google.redirectUri });
}));
r.get('/integrations/drive', FULL, ah(async (_req, res) => res.json(await driveSettingsView())));
r.post('/integrations/drive/test', FULL, ah(async (_req, res) => res.json(await testDriveConnection())));
r.get('/integrations/:service/connect', FULL, ah(async (req, res) => res.json({ url: google.buildAuthUrl(service(req), req.user.id) })));
r.delete('/integrations/:service', FULL, ah(async (req, res) => {
  await google.disconnect(service(req));
  resetEmailReady();
  res.json(await google.integrationStatus());
}));
r.post('/integrations/gmail/test', FULL, ah(async (req, res) => {
  const to = z.string().trim().toLowerCase().email('Correo no válido').optional().parse(req.body?.to || undefined) || req.user.email;
  const lang = z.enum(['es', 'en']).optional().parse(req.body?.language || undefined);
  const result = await sendEmail('test', to, { name: req.user.name }, { lang });
  await recordMailTest(result);
  resetEmailReady();
  res.json({ ...result, to, language: lang || null });
}));

r.get('/admins', FULL, ah(async (_req, res) => res.json(await admin.listAdmins())));
r.post('/admins', FULL, validate(createAdminSchema), ah(async (req, res) => res.status(201).json(await admin.createAdmin(req.body))));
r.patch('/admins/:id/level', FULL, validate(adminLevelSchema), ah(async (req, res) => res.json(await admin.setAdminLevel(req, req.params.id, req.body))));
r.patch('/admins/:id/status', FULL, validate(adminUserSchema), ah(async (req, res) => res.json(await admin.setAdminActive(req, req.params.id, req.body))));
r.post('/admins/:id/password', FULL, validate(adminPasswordSchema), ah(async (req, res) => {
  await admin.setAdminPassword(req, req.params.id, req.body);
  res.json({ message: 'Contraseña actualizada' });
}));
r.delete('/admins/:id', FULL, ah(async (req, res) => {
  await admin.deleteAdmin(req, req.params.id);
  res.json({ ok: true });
}));

export default r;

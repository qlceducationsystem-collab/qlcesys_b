import { publicChargeInfo } from '../services/payments/paymentSettings.service.js';
import { publicBitgetInfo } from '../services/payments/bitgetSettings.service.js';
import * as bitget from '../services/payments/bitgetReport.service.js';
import { evidenceUpload } from '../middlewares/upload.js';
import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { requireRole } from '../middlewares/auth.js';
import { cachedActiveOffers, getAccess } from '../services/access.service.js';
import * as payments from '../services/payments/payment.service.js';
import { activeProvider, activeProviders } from '../services/payments/providers.js';
import { checkPromotion } from '../services/promotion.service.js';
import * as subscribers from '../services/subscriber.service.js';
import { creditBalance } from '../services/credit.service.js';
import { authLimiter } from '../middlewares/rateLimit.js';

const r = Router();
const checkoutSchema = z.object({
  offerCode: z.string().trim().min(1).max(40).optional(),
  provider: z.enum(['MERCADOPAGO', 'BITGET']).optional(),
  promoCode: z.string().trim().min(4).max(40).optional(),
  quantity: z.coerce.number().int().min(1).max(payments.MAX_GIFTS).optional(),
  gift: z.object({
    quantity: z.coerce.number().int().min(1).max(payments.MAX_GIFTS).default(1),
    message: z.string().trim().max(500).optional().nullable(),
    recipientName: z.string().trim().max(120).optional().nullable(),
  }).optional().nullable(),
}).refine((v) => v.offerCode || v.promoCode, { message: 'Selecciona un producto', path: ['offerCode'] });
const reportSchema = z.object({
  orderNumber: z.string().trim().min(1, 'Requerido').max(128),
  transferredAt: z.string().trim().min(1, 'Requerido').max(40),
  removeFileIds: z.union([z.string().max(40), z.array(z.string().max(40)).max(5)]).optional(),
});
const resolveSchema = z.object({ outcome: z.enum(['APPROVED', 'REJECTED']) });
const codeSchema = z.object({ code: z.string().trim().min(4).max(40) });
const preferencesSchema = z.object({ marketingOptOut: z.boolean() });

r.get('/access', ah(async (req, res) => {
  const [access, offers, providers, charge, bitgetInfo] = await Promise.all([getAccess(req.user.id), cachedActiveOffers(), activeProviders(req.user), publicChargeInfo(), publicBitgetInfo()]);
  const provider = providers[0] ? providers[0].code : await activeProvider(null, req.user).then((p) => p.code).catch(() => 'NONE');
  const subscription = req.user.role === 'CLIENT' ? await subscribers.subscriptionStatus(req.user) : null;
  const codes = providers.map((p) => p.code);
  res.json({ access, offers, provider, providers: codes, charge: codes.includes('MERCADOPAGO') ? charge : null, bitget: codes.includes('BITGET') ? bitgetInfo : null, residenceCountry: req.user.residenceCountry || null, subscription });
}));

r.get('/attempts', ah(async (req, res) => res.json(await payments.listMyAttempts(req.user.id))));

r.post('/checkout', requireRole('CLIENT'), validate(checkoutSchema), ah(async (req, res) => {
  res.status(201).json(await payments.createCheckout(req.user, req.body));
}));

r.get('/credits', ah(async (req, res) => res.json(await creditBalance(req.user.id))));

r.post('/promo/check', requireRole('CLIENT'), validate(codeSchema), ah(async (req, res) => res.json(await checkPromotion(req.user.id, req.body.code))));

r.post('/subscription/cancel', requireRole('CLIENT'), ah(async (req, res) => res.json(await subscribers.cancelSubscription(req.user))));
r.post('/subscription/resume', requireRole('CLIENT'), ah(async (req, res) => res.json(await subscribers.resumeSubscription(req.user))));
r.put('/preferences', requireRole('CLIENT'), validate(preferencesSchema), ah(async (req, res) => res.json(await subscribers.setMarketing(req.user, req.body))));

r.get('/bitget', requireRole('CLIENT'), ah(async (req, res) => res.json(await bitget.clientOverview(req.user))));
r.post('/attempts/:id/bitget-report', requireRole('CLIENT'), authLimiter, evidenceUpload, validate(reportSchema), ah(async (req, res) => res.status(201).json(await bitget.submitReport(req.user, req.params.id, req.body, req.files))));
r.put('/bitget/reports/:id', requireRole('CLIENT'), authLimiter, evidenceUpload, validate(reportSchema), ah(async (req, res) => res.json(await bitget.correctReport(req.user, req.params.id, req.body, req.files))));
r.post('/bitget/reports/:id/hide', requireRole('CLIENT'), ah(async (req, res) => res.json(await bitget.hideReport(req.user, req.params.id))));
r.get('/bitget/files/:id', ah(async (req, res) => bitget.streamEvidence(req.user, req.params.id, req.headers.range, res)));

r.post('/attempts/:id/sync', requireRole('CLIENT'), ah(async (req, res) => {
  const result = await payments.syncAttempt(req.user, req.params.id);
  const [access, credits] = await Promise.all([getAccess(req.user.id), creditBalance(req.user.id)]);
  res.json({ ...result, access, credits });
}));

r.post('/attempts/:id/simulate', requireRole('CLIENT'), validate(resolveSchema), ah(async (req, res) => {
  const result = await payments.resolveSimulated(req.user, req.params.id, req.body.outcome);
  res.json({ ...result, access: await getAccess(req.user.id) });
}));

export default r;

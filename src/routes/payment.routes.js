import { publicChargeInfo } from '../services/payments/paymentSettings.service.js';
import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { requireRole } from '../middlewares/auth.js';
import { cachedActiveOffers, getAccess } from '../services/access.service.js';
import * as payments from '../services/payments/payment.service.js';
import { activeProvider } from '../services/payments/providers.js';
import { checkPromotion } from '../services/promotion.service.js';
import * as subscribers from '../services/subscriber.service.js';
import { creditBalance } from '../services/credit.service.js';
import { authLimiter } from '../middlewares/rateLimit.js';

const r = Router();
const checkoutSchema = z.object({
  offerCode: z.string().trim().min(1).max(40).optional(),
  promoCode: z.string().trim().min(4).max(40).optional(),
  quantity: z.coerce.number().int().min(1).max(payments.MAX_GIFTS).optional(),
  gift: z.object({
    quantity: z.coerce.number().int().min(1).max(payments.MAX_GIFTS).default(1),
    message: z.string().trim().max(500).optional().nullable(),
    recipientName: z.string().trim().max(120).optional().nullable(),
  }).optional().nullable(),
}).refine((v) => v.offerCode || v.promoCode, { message: 'Selecciona un producto', path: ['offerCode'] });
const cardSchema = z.object({
  token: z.string().trim().min(1).max(200),
  paymentMethodId: z.string().trim().min(1).max(40),
  issuerId: z.string().trim().max(40).optional(),
  deviceId: z.string().trim().max(200).optional(),
});
const resolveSchema = z.object({ outcome: z.enum(['APPROVED', 'REJECTED']) });
const codeSchema = z.object({ code: z.string().trim().min(4).max(40) });
const preferencesSchema = z.object({ marketingOptOut: z.boolean() });

r.get('/access', ah(async (req, res) => {
  const [access, offers, provider, charge] = await Promise.all([getAccess(req.user.id), cachedActiveOffers(), activeProvider(), publicChargeInfo()]);
  const subscription = req.user.role === 'CLIENT' ? await subscribers.subscriptionStatus(req.user) : null;
  res.json({ access, offers, provider: provider.code, charge, subscription });
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

r.post('/attempts/:id/card', requireRole('CLIENT'), authLimiter, validate(cardSchema), ah(async (req, res) => {
  const result = await payments.payWithCard(req.user, req.params.id, req.body);
  const [access, credits] = await Promise.all([getAccess(req.user.id), creditBalance(req.user.id)]);
  res.json({ ...result, access, credits });
}));

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

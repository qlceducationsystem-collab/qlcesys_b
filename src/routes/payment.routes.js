import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { requireRole } from '../middlewares/auth.js';
import { cachedActiveOffers, getAccess } from '../services/access.service.js';
import * as payments from '../services/payments/payment.service.js';
import { activeProvider } from '../services/payments/providers.js';

const r = Router();
const checkoutSchema = z.object({ offerCode: z.string().trim().min(1).max(40) });
const resolveSchema = z.object({ outcome: z.enum(['APPROVED', 'REJECTED']) });

r.get('/access', ah(async (req, res) => {
  const [access, offers] = await Promise.all([getAccess(req.user.id), cachedActiveOffers()]);
  res.json({ access, offers, provider: activeProvider().code });
}));

r.get('/attempts', ah(async (req, res) => res.json(await payments.listMyAttempts(req.user.id))));

r.post('/checkout', requireRole('CLIENT'), validate(checkoutSchema), ah(async (req, res) => {
  res.status(201).json(await payments.createCheckout(req.user, req.body.offerCode));
}));

r.post('/attempts/:id/simulate', requireRole('CLIENT'), validate(resolveSchema), ah(async (req, res) => {
  const result = await payments.resolveSimulated(req.user, req.params.id, req.body.outcome);
  res.json({ ...result, access: await getAccess(req.user.id) });
}));

export default r;

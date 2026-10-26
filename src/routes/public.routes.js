import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { leadSchema } from '../validations/schemas.js';
import { createLead } from '../services/lead.service.js';
import { cachedActiveOffers } from '../services/access.service.js';
import { getLoginNotice } from '../services/loginNotice.service.js';
import { handleCallback } from '../services/google/oauth.js';
import { streamWithToken } from '../services/moduleMedia.service.js';

export const publicRouter = Router();
export const googleRouter = Router();
export const mediaRouter = Router();

const leadsLimiter = rateLimit({ windowMs: 60 * 60000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => env.isTest, message: { error: 'Demasiadas solicitudes, intenta más tarde' } });

publicRouter.post('/leads', leadsLimiter, validate(leadSchema), ah(async (req, res) => res.status(201).json(await createLead(req.body))));

publicRouter.get('/offers', ah(async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
  res.json({ offers: await cachedActiveOffers() });
}));

publicRouter.get('/notice', ah(async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(await getLoginNotice());
}));

googleRouter.get('/callback', async (req, res) => {
  const target = `${env.frontendUrl}/admin/integraciones`;
  if (req.query.error) return res.redirect(`${target}?error=${encodeURIComponent(String(req.query.error))}`);
  try {
    const service = await handleCallback({ code: req.query.code, state: req.query.state });
    res.redirect(`${target}?connected=${service}`);
  } catch (err) {
    res.redirect(`${target}?error=${encodeURIComponent(err.message)}`);
  }
});

mediaRouter.get('/:id', ah(async (req, res) => streamWithToken(req.params.id, req.query.t, req.headers.range, res)));

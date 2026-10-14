import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { optionalAuth } from '../middlewares/auth.js';
import { analyticsEventSchema } from '../validations/schemas.js';
import { publicContent } from '../services/publicContent.service.js';
import { PUBLIC_EVENTS, track } from '../services/analytics.service.js';
import { handleCallback } from '../services/google/oauth.js';
import { streamWithToken } from '../services/moduleMedia.service.js';

export const publicRouter = Router();
export const googleRouter = Router();
export const mediaRouter = Router();

const eventsLimiter = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => env.isTest });

publicRouter.get('/content', ah(async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json(await publicContent());
}));

publicRouter.post('/events', eventsLimiter, optionalAuth, validate(analyticsEventSchema), ah(async (req, res) => {
  if (!PUBLIC_EVENTS.includes(req.body.event)) return res.status(204).end();
  await track(req.body.event, { userId: req.user?.id, sessionId: req.body.sessionId, path: req.body.path, metadata: req.body.metadata });
  res.status(204).end();
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

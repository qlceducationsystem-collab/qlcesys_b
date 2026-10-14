import { Router } from 'express';
import { ah } from '../utils/asyncHandler.js';
import { authenticate } from '../middlewares/auth.js';
import { getPlan } from '../config/plans.js';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import * as subs from '../services/subscription.service.js';

const r = Router();

// Público: datos del plan para la web gratuita (sin secretos).
r.get('/plan', (_req, res) => {
  const { name, amount, currency, frequencyType } = getPlan();
  res.json({ name, amount, currency, frequencyType, publicKey: env.mercadoPago.publicKey || null });
});

r.get('/me', authenticate, ah(async (req, res) => res.json(await subs.getMySubscription(req.user.id))));
r.post('/checkout', authenticate, ah(async (req, res) => res.json(await subs.createCheckout(req.user))));
r.post('/cancel', authenticate, ah(async (req, res) => res.json(await subs.cancelSubscription(req.user.id))));
r.get('/payments', authenticate, ah(async (req, res) => {
  res.json(await prisma.payment.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } }));
}));

export default r;

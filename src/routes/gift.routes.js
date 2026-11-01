import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import { getAccess } from '../services/access.service.js';
import { myGifts, redeemGift } from '../services/gift.service.js';

const r = Router();
const redeemSchema = z.object({ code: z.string().trim().min(6).max(40) });

r.get('/mine', ah(async (req, res) => res.json(await myGifts(req.user.id))));

r.post('/redeem', authLimiter, validate(redeemSchema), ah(async (req, res) => {
  const result = await redeemGift(req.user, req.body.code);
  res.json({ ...result, access: await getAccess(req.user.id) });
}));

export default r;

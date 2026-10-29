import { Router } from 'express';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import * as schemas from '../validations/schemas.js';
import * as auth from '../services/auth.service.js';
import { resetProfile } from '../services/profileReset.service.js';

const r = Router();

r.post('/register/email-code', authLimiter, validate(schemas.emailCodeSchema), ah(async (req, res) => res.json(await auth.sendRegisterCode(req.body))));
r.post('/register', authLimiter, validate(schemas.registerSchema), ah(async (req, res) => res.status(201).json(await auth.register(req.body))));
r.post('/login', authLimiter, validate(schemas.loginSchema), ah(async (req, res) => res.json(await auth.login(req.body))));
r.post('/login/2fa', authLimiter, validate(schemas.codeLoginSchema), ah(async (req, res) => res.json(await auth.loginWithCode(req.body))));
r.post('/2fa/setup', authLimiter, validate(schemas.challengeSchema), ah(async (req, res) => res.json(await auth.beginSetup(req.body))));
r.post('/2fa/activate', authLimiter, validate(schemas.activateTwoFactorSchema), ah(async (req, res) => res.json(await auth.activateTwoFactor(req.body))));
r.get('/me', authenticate, ah(async (req, res) => res.json({ user: await auth.me(req.user.id) })));
r.post('/reset-profile', authenticate, authLimiter, ah(async (req, res) => res.json(await resetProfile(req.user, req.body || {}))));
r.post('/delete-account', authenticate, authLimiter, ah(async (req, res) => res.json(await auth.deleteAccount(req.user.id, req.body || {}))));
r.post('/logout', (_req, res) => res.json({ ok: true }));

r.post('/reset-password', authLimiter, validate(schemas.resetWithCodeSchema), ah(async (req, res) => {
  await auth.resetPasswordWithCode(req.body);
  res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
}));

r.post('/change-password', authenticate, validate(schemas.changePasswordSchema), ah(async (req, res) => {
  await auth.changePassword(req.user.id, req.body);
  res.json({ message: 'Contraseña actualizada' });
}));

export default r;

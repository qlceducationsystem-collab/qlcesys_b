import { Router } from 'express';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { authLimiter } from '../middlewares/rateLimit.js';
import * as schemas from '../validations/schemas.js';
import * as auth from '../services/auth.service.js';

const r = Router();

r.post('/register', authLimiter, validate(schemas.registerSchema), ah(async (req, res) => res.status(201).json(await auth.register(req.body))));
r.post('/login', authLimiter, validate(schemas.loginSchema), ah(async (req, res) => res.json(await auth.login(req.body))));
r.get('/me', authenticate, ah(async (req, res) => res.json({ user: await auth.me(req.user.id) })));
// Con JWT stateless el cierre de sesión se completa en el cliente al descartar el token.
r.post('/logout', (_req, res) => res.json({ ok: true }));

r.post('/forgot-password', authLimiter, validate(schemas.forgotSchema), ah(async (req, res) => {
  await auth.requestPasswordReset(req.body.email);
  res.json({ message: 'Si el correo existe, recibirás instrucciones para restablecer tu contraseña.' });
}));
r.post('/reset-password', authLimiter, validate(schemas.resetSchema), ah(async (req, res) => {
  await auth.resetPassword(req.body);
  res.json({ message: 'Contraseña actualizada' });
}));
r.post('/change-password', authenticate, validate(schemas.changePasswordSchema), ah(async (req, res) => {
  await auth.changePassword(req.user.id, req.body);
  res.json({ message: 'Contraseña actualizada' });
}));

export default r;

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { signToken } from '../middlewares/auth.js';
import { badRequest, conflict, unauthorized } from '../utils/httpError.js';
import { track } from './analytics.service.js';
import { sendEmail } from './email.service.js';

export const SALT_ROUNDS = 12;
const RESET_TTL_MIN = 60;
export const publicUser = ({ id, email, name, role, adminLevel, phone, createdAt }) => ({ id, email, name, role, adminLevel, phone, createdAt });
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export async function register({ name, email, password, phone }, { sessionId } = {}) {
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw conflict('Ya existe una cuenta con ese correo');
  const user = await prisma.user.create({
    data: { name, email, phone, role: 'CLIENT', lastLoginAt: new Date(), passwordHash: await bcrypt.hash(password, SALT_ROUNDS) },
  });
  await track('REGISTER', { userId: user.id, sessionId });
  sendEmail('welcome', user.email, { name: user.name });
  return { token: signToken(user), user: publicUser(user) };
}

export async function login({ email, password }, { sessionId } = {}) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
    throw unauthorized('Correo o contraseña incorrectos');
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await track('LOGIN', { userId: user.id, sessionId, metadata: { source: user.role } });
  return { token: signToken(user), user: publicUser(user) };
}

export async function me(userId) {
  return publicUser(await prisma.user.findUnique({ where: { id: userId } }));
}

export async function requestPasswordReset(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return;
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60000) },
  });
  const url = `${env.frontendUrl}/restablecer?token=${token}`;
  const { sent } = await sendEmail('passwordReset', user.email, { name: user.name, url });
  if (!sent && !env.isProd) console.info(`[dev] Enlace de recuperación para ${email}: ${url}`);
}

export async function resetPassword({ token, password }) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) throw badRequest('El enlace es inválido o expiró');
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await bcrypt.hash(password, SALT_ROUNDS) } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw badRequest('La contraseña actual no es correcta');
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) } });
}

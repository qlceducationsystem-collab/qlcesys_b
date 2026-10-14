import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { signToken } from '../middlewares/auth.js';
import { badRequest, conflict, unauthorized } from '../utils/httpError.js';

export const SALT_ROUNDS = 12;
const RESET_TTL_MIN = 60;
export const publicUser = ({ id, email, name, role, adminLevel, phone, createdAt }) => ({ id, email, name, role, adminLevel, phone, createdAt });
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export async function register({ name, email, password, phone }) {
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw conflict('Ya existe una cuenta con ese correo');
  const user = await prisma.user.create({
    data: { name, email, phone, passwordHash: await bcrypt.hash(password, SALT_ROUNDS) },
  });
  return { token: signToken(user), user: publicUser(user) };
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Mismo mensaje para correo o contraseña incorrectos.
  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
    throw unauthorized('Correo o contraseña incorrectos');
  }
  return { token: signToken(user), user: publicUser(user) };
}

export async function me(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return publicUser(user);
}

// Genera token de recuperación. El envío por correo se conecta al proveedor
// de email cuando se configure; en desarrollo se muestra en consola.
export async function requestPasswordReset(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60000) },
  });
  const url = `${env.frontendUrls[0]}/restablecer?token=${token}`;
  if (!env.isProd) console.info(`[dev] Enlace de recuperación para ${email}: ${url}`);
  return url;
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

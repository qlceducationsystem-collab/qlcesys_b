import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { signChallenge, signEmailToken, signToken, verifyChallenge, verifyEmailToken } from '../middlewares/auth.js';
import { HttpError, badRequest, conflict, notFound, unauthorized } from '../utils/httpError.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
import { generateSecret, matchStep, otpauthUrl } from '../utils/totp.js';
import { trackLogin } from './analytics.service.js';
import { emailReady, sendEmail, testEmail } from './email.service.js';

export const SALT_ROUNDS = 12;
const ISSUER = 'QLC Financial Education';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const EMAIL_CODE_MINUTES = 10;

const codeHash = (email, code) => crypto.createHmac('sha256', env.jwtSecret).update(`${email}:${code}`).digest('hex');

const emailRequired = () => process.env.NODE_ENV !== 'test' || testEmail.required;

export async function sendRegisterCode({ email }) {
  if (!(await emailReady())) {
    if (!emailRequired()) return { required: false };
    throw new HttpError(503, 'El registro está en pausa: falta conectar el envío de correos para mandarte el código de verificación. Intenta más tarde.');
  }
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('Ya existe una cuenta con ese correo');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const result = await sendEmail('verifyEmail', email, { code, minutes: EMAIL_CODE_MINUTES });
  if (!result.sent) throw new HttpError(502, 'No pudimos enviar el código a tu correo. Revisa la dirección e intenta de nuevo.');
  return { required: true, emailToken: signEmailToken(email, codeHash(email, code), EMAIL_CODE_MINUTES), minutes: EMAIL_CODE_MINUTES };
}

async function assertEmailVerified({ email, emailToken, emailCode }) {
  if (!(await emailReady()) && !emailRequired()) return;
  if (!emailToken || !emailCode) throw badRequest('Confirma tu correo con el código que te enviamos.');
  const payload = verifyEmailToken(emailToken);
  const expected = Buffer.from(payload.h || '', 'hex');
  const actual = Buffer.from(codeHash(email, emailCode), 'hex');
  if (payload.email !== email || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw badRequest('Código de verificación de correo incorrecto');
  }
}

export const publicUser = ({ id, email, name, role, adminLevel, phone, createdAt, totpEnabledAt }) => ({
  id, email, name, role, adminLevel, phone, createdAt, twoFactorEnabled: !!totpEnabledAt,
});

const twoFactorReady = () => {
  if (!env.tokenEncryptionKey) throw new HttpError(503, 'La verificación en dos pasos está pendiente de configuración en el servidor');
};

async function startSession(user) {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await trackLogin(user.id);
  return { status: 'OK', token: signToken(user), user: publicUser(user) };
}

const setupChallenge = (user) => ({ status: 'SETUP_2FA', challengeToken: signChallenge(user), user: publicUser(user) });

export async function register({ name, email, password, phone, legalVersion, emailToken, emailCode }) {
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw conflict('Ya existe una cuenta con ese correo');
  await assertEmailVerified({ email, emailToken, emailCode });
  const user = await prisma.user.create({
    data: { name, email, phone, role: 'CLIENT', legalAcceptedAt: new Date(), legalVersion, passwordHash: await bcrypt.hash(password, SALT_ROUNDS) },
  });
  sendEmail('welcome', user.email, { name: user.name });
  return setupChallenge(user);
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
    throw unauthorized('Correo o contraseña incorrectos');
  }
  if (!user.totpEnabledAt) return setupChallenge(user);
  return startSession(user);
}

async function verifyUserCode(user, code) {
  twoFactorReady();
  if (user.totpLockedUntil && user.totpLockedUntil > new Date()) {
    throw new HttpError(429, 'Demasiados códigos incorrectos. Intenta de nuevo en unos minutos.');
  }
  const step = matchStep(decryptSecret(user.totpSecret), code);
  if (step === null || (user.totpLastStep !== null && step <= user.totpLastStep)) {
    const failed = user.totpFailedAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: failed >= MAX_FAILED
        ? { totpFailedAttempts: 0, totpLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) }
        : { totpFailedAttempts: failed },
    });
    throw unauthorized('Código de verificación incorrecto');
  }
  await prisma.user.update({ where: { id: user.id }, data: { totpLastStep: step, totpFailedAttempts: 0, totpLockedUntil: null } });
}

async function userWithTwoFactor(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || !user.totpEnabledAt) throw unauthorized('Correo o código de verificación incorrectos');
  return user;
}

export async function loginWithCode({ email, code }) {
  const user = await userWithTwoFactor(email);
  await verifyUserCode(user, code);
  return startSession(user);
}

async function challengeUser(challengeToken) {
  const user = await prisma.user.findUnique({ where: { id: verifyChallenge(challengeToken) } });
  if (!user || !user.isActive) throw unauthorized('Usuario no disponible');
  if (user.totpEnabledAt) throw conflict('La verificación en dos pasos ya está activada. Inicia sesión.');
  return user;
}

export async function beginSetup({ challengeToken }) {
  twoFactorReady();
  const user = await challengeUser(challengeToken);
  const secret = generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpPendingSecret: encryptSecret(secret) } });
  const url = otpauthUrl({ secret, account: user.email, issuer: ISSUER });
  return { secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }), account: user.email, issuer: ISSUER };
}

export async function activateTwoFactor({ challengeToken, code }) {
  twoFactorReady();
  const user = await challengeUser(challengeToken);
  if (!user.totpPendingSecret) throw badRequest('Genera primero tu código QR');
  const secret = decryptSecret(user.totpPendingSecret);
  const step = matchStep(secret, code);
  if (step === null) throw unauthorized('Código de verificación incorrecto');
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: user.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: step, totpFailedAttempts: 0 },
  });
  return startSession(updated);
}

export async function resetPasswordWithCode({ email, code, password }) {
  const user = await userWithTwoFactor(email);
  await verifyUserCode(user, code);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, SALT_ROUNDS) } });
}

export async function me(userId) {
  return publicUser(await prisma.user.findUnique({ where: { id: userId } }));
}

export async function changePassword(userId, { code, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user.totpEnabledAt) throw badRequest('Activa primero la verificación en dos pasos');
  await verifyUserCode(user, code);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) } });
}

export async function resetTwoFactor(clientId) {
  const { count } = await prisma.user.updateMany({
    where: { id: clientId, role: 'CLIENT' },
    data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, totpFailedAttempts: 0, totpLockedUntil: null },
  });
  if (!count) throw notFound('Cliente no encontrado');
}

export async function deleteAccount(userId, { confirm, code }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Usuario no encontrado');
  if (user.role !== 'CLIENT') throw new HttpError(403, 'Las cuentas de administrador no se eliminan desde aquí');
  if (confirm !== 'ELIMINAR') throw badRequest('Escribe ELIMINAR para confirmar');
  await verifyUserCode(user, String(code || ''));
  await prisma.user.delete({ where: { id: user.id } });
  return { ok: true };
}

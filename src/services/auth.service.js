import { cancelUserSubscriptions } from './subscription.service.js';
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
import { actorOf, recordEvent } from './adminEvent.service.js';
import { emailReady, sendEmail, sendClientEmail } from './email.service.js';

export const SALT_ROUNDS = 12;
const ISSUER = 'QLC Financial Education';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const EMAIL_CODE_MINUTES = 10;
const RESET_CODE_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5;
const RESET_COOLDOWN_MS = 60000;

const codeHash = (email, code) => crypto.createHmac('sha256', env.jwtSecret).update(`${email}:${code}`).digest('hex');

export async function sendRegisterCode({ email, language }) {
  if (!(await emailReady())) return { required: false };
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('Ya existe una cuenta con ese correo');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const result = await sendEmail('verifyEmail', email, { code, minutes: EMAIL_CODE_MINUTES }, { lang: language });
  if (!result.sent) throw new HttpError(502, 'No pudimos enviar el código a tu correo. Revisa la dirección e intenta de nuevo.');
  return { required: true, emailToken: signEmailToken(email, codeHash(email, code), EMAIL_CODE_MINUTES), minutes: EMAIL_CODE_MINUTES };
}

async function assertEmailVerified({ email, emailToken, emailCode }) {
  if (!(await emailReady())) return;
  if (!emailToken || !emailCode) throw badRequest('Confirma tu correo con el código que te enviamos.');
  const payload = verifyEmailToken(emailToken);
  const expected = Buffer.from(payload.h || '', 'hex');
  const actual = Buffer.from(codeHash(email, emailCode), 'hex');
  if (payload.email !== email || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw badRequest('Código de verificación de correo incorrecto');
  }
}

export const publicUser = ({ id, email, name, role, adminLevel, phone, residenceCountry, createdAt, totpEnabledAt, language }) => ({
  id, email, name, role, adminLevel, phone, residenceCountry: residenceCountry || null, createdAt, language, twoFactorEnabled: !!totpEnabledAt,
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

export async function register({ name, email, password, phone, residenceCountry, legalVersion, emailToken, emailCode, language }) {
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw conflict('Ya existe una cuenta con ese correo');
  await assertEmailVerified({ email, emailToken, emailCode });
  const user = await prisma.user.create({
    data: { name, email, phone, residenceCountry, role: 'CLIENT', language: language || 'es', legalAcceptedAt: new Date(), legalVersion, passwordHash: await bcrypt.hash(password, SALT_ROUNDS) },
  });
  sendClientEmail('BIENVENIDA', 'welcome', user.email, { name: user.name }).catch(() => null);
  recordEvent({ category: 'PLATAFORMA', type: 'NUEVO_REGISTRO', actor: actorOf(user), user, status: 'Cuenta creada' }).catch(() => null);
  return setupChallenge(user);
}

export async function setResidenceCountry(userId, residenceCountry) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user.residenceCountry) throw conflict('Tu país de residencia ya está registrado. Si necesitas cambiarla, escríbenos.');
  return publicUser(await prisma.user.update({ where: { id: userId }, data: { residenceCountry } }));
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
    throw unauthorized('Correo o contraseña incorrectos');
  }
  if (!user.totpEnabledAt) return setupChallenge(user);
  return startSession(user);
}

export async function verifyUserCode(user, code) {
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

const resetHash = (email, code) => codeHash(`reset:${email}`, code);
const RESET_SENT = 'Si el correo está registrado, te enviamos un código para restablecer tu contraseña. Revisa también la carpeta de spam.';

export async function requestPasswordReset({ email }) {
  if (!(await emailReady())) throw new HttpError(503, 'El restablecimiento por correo todavía no está disponible. Usa tu código de Google Authenticator o contacta al equipo de QLC.');
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.isActive && user.role === 'CLIENT') {
    const issuedAt = user.resetCodeExpiresAt ? user.resetCodeExpiresAt.getTime() - RESET_CODE_MINUTES * 60000 : 0;
    if (Date.now() - issuedAt >= RESET_COOLDOWN_MS) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      await prisma.user.update({
        where: { id: user.id },
        data: { resetCodeHash: resetHash(email, code), resetCodeExpiresAt: new Date(Date.now() + RESET_CODE_MINUTES * 60000), resetCodeAttempts: 0 },
      });
      sendEmail('passwordReset', email, { name: user.name, code, minutes: RESET_CODE_MINUTES }).catch(() => null);
    }
  }
  return { message: RESET_SENT, minutes: RESET_CODE_MINUTES };
}

export async function confirmPasswordReset({ email, code, password }) {
  const invalid = badRequest('Código incorrecto o vencido. No se cambió tu contraseña.');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || user.role !== 'CLIENT' || !user.resetCodeHash || !user.resetCodeExpiresAt || user.resetCodeExpiresAt <= new Date()) throw invalid;
  const expected = Buffer.from(user.resetCodeHash, 'hex');
  const actual = Buffer.from(resetHash(email, code), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    const attempts = user.resetCodeAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: attempts >= RESET_MAX_ATTEMPTS ? { resetCodeHash: null, resetCodeExpiresAt: null, resetCodeAttempts: 0 } : { resetCodeAttempts: attempts },
    });
    throw invalid;
  }
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const claimed = await prisma.user.updateMany({
    where: { id: user.id, resetCodeHash: user.resetCodeHash },
    data: {
      passwordHash, resetCodeHash: null, resetCodeExpiresAt: null, resetCodeAttempts: 0, sessionsValidFrom: new Date(),
      totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, totpFailedAttempts: 0, totpLockedUntil: null,
    },
  });
  if (!claimed.count) throw invalid;
  sendEmail('passwordChanged', email, { name: user.name }).catch(() => null);
  recordEvent({ category: 'PLATAFORMA', type: 'CONTRASENA_RESTABLECIDA', actor: actorOf(user), user, status: 'Restablecida', result: 'Por código enviado al correo. Debe registrar de nuevo Google Authenticator.' }).catch(() => null);
  return { message: 'Contraseña restablecida. Al iniciar sesión deberás registrar de nuevo Google Authenticator.' };
}

export async function setLanguage(userId, language) {
  await prisma.user.update({ where: { id: userId }, data: { language } });
  return { language };
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
  await recordEvent({ category: 'PLATAFORMA', type: 'CUENTA_ELIMINADA', actor: actorOf(user), user, status: 'Eliminada' }).catch(() => null);
  await cancelUserSubscriptions(user.id);
  await prisma.user.delete({ where: { id: user.id } });
  return { ok: true };
}

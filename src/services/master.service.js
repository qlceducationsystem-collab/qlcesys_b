import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { HttpError, badRequest, conflict, forbidden } from '../utils/httpError.js';
import { verifyUserCode } from './auth.service.js';
import { actorOf, recordEvent } from './adminEvent.service.js';

const ID = 'general';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const ROUNDS = 12;

const strong = (password) => {
  const p = String(password || '');
  if (p.length < 12 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) throw badRequest('La contraseña maestra debe tener al menos 12 caracteres, con letras y números');
  return p;
};

const fullUser = (id) => prisma.user.findUnique({ where: { id } });

export async function masterStatus(admin) {
  const key = await prisma.masterKey.findUnique({ where: { id: ID } });
  const owner = key ? await prisma.user.findUnique({ where: { id: key.ownerId }, select: { name: true, email: true } }) : null;
  const canClaim = !key && admin.adminLevel === 'FULL' && (!env.generalAdminEmail || env.generalAdminEmail === admin.email.toLowerCase());
  return {
    configured: !!key,
    isGeneralAdmin: !!key && key.ownerId === admin.id,
    ownerName: owner?.name || null,
    canClaim,
    lockedUntil: key?.lockedUntil && key.lockedUntil > new Date() ? key.lockedUntil : null,
  };
}

export async function setupMaster(admin, { password, code }) {
  if (admin.adminLevel !== 'FULL') throw forbidden('Solo un administrador con nivel total puede configurar la contraseña maestra');
  if (env.generalAdminEmail && env.generalAdminEmail !== admin.email.toLowerCase()) throw forbidden('Esta cuenta no está designada como Administrador General');
  if (await prisma.masterKey.findUnique({ where: { id: ID } })) throw conflict('La contraseña maestra ya está configurada');
  const user = await fullUser(admin.id);
  await verifyUserCode(user, String(code || ''));
  await prisma.masterKey.create({ data: { id: ID, hash: await bcrypt.hash(strong(password), ROUNDS), ownerId: admin.id } });
  await recordEvent({ category: 'ACCESO', type: 'CONTRASENA_MAESTRA', actor: actorOf(admin), result: `${admin.name} quedó como Administrador General` });
  return masterStatus(admin);
}

export async function assertMaster(admin, { masterPassword, code }) {
  const key = await prisma.masterKey.findUnique({ where: { id: ID } });
  if (!key) throw forbidden('Primero configure la contraseña maestra del Administrador General');
  if (key.ownerId !== admin.id) throw forbidden('Esta operación es exclusiva del Administrador General');
  if (key.lockedUntil && key.lockedUntil > new Date()) throw new HttpError(429, 'Demasiados intentos con la contraseña maestra. Intente de nuevo en unos minutos.');
  const ok = await bcrypt.compare(String(masterPassword || ''), key.hash);
  if (!ok) {
    const failed = key.failedAttempts + 1;
    await prisma.masterKey.update({
      where: { id: ID },
      data: failed >= MAX_FAILED ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } : { failedAttempts: failed },
    });
    await recordEvent({ category: 'ACCESO', type: 'AUTORIZACION_FALLIDA', actor: actorOf(admin), result: 'Contraseña maestra incorrecta' });
    throw new HttpError(401, 'Contraseña maestra incorrecta');
  }
  const user = await fullUser(admin.id);
  await verifyUserCode(user, String(code || ''));
  if (key.failedAttempts || key.lockedUntil) await prisma.masterKey.update({ where: { id: ID }, data: { failedAttempts: 0, lockedUntil: null } });
}

export async function changeMaster(admin, { masterPassword, code, password }) {
  await assertMaster(admin, { masterPassword, code });
  await prisma.masterKey.update({ where: { id: ID }, data: { hash: await bcrypt.hash(strong(password), ROUNDS) } });
  await recordEvent({ category: 'ACCESO', type: 'CONTRASENA_MAESTRA_CAMBIADA', actor: actorOf(admin), result: 'Actualizada' });
  return masterStatus(admin);
}

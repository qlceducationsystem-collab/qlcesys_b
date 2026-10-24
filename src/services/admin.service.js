import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { grantWindow, renewalBase, summarizeAccess } from '../domain/access.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { publicUser, SALT_ROUNDS } from './auth.service.js';
import { invalidateOffersCache, publicOffer } from './access.service.js';

const clientSelect = {
  id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true, lastLoginAt: true, totpEnabledAt: true,
  accessGrants: { where: { active: true } },
  progress: { where: { status: 'COMPLETED' }, select: { id: true } },
  _count: { select: { periods: true, monthlyCloses: true, appointments: true } },
};

const toClient = ({ accessGrants, progress, _count, totpEnabledAt, ...u }) => ({
  ...u,
  twoFactorEnabled: !!totpEnabledAt,
  counts: _count,
  completedModules: progress.length,
  access: summarizeAccess(accessGrants),
});

export async function listClients({ q = '' } = {}) {
  const term = String(q || '').trim();
  const rows = await prisma.user.findMany({
    where: {
      role: 'CLIENT',
      ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }] } : {}),
    },
    select: clientSelect,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map(toClient);
}

export async function getClient(id) {
  const row = await prisma.user.findFirst({ where: { id, role: 'CLIENT' }, select: clientSelect });
  if (!row) throw notFound('Cliente no encontrado');
  const grants = await prisma.accessGrant.findMany({ where: { userId: id }, include: { offer: true }, orderBy: { createdAt: 'desc' } });
  return { ...toClient(row), grants: grants.map((g) => ({ id: g.id, offer: g.offer.name, accessType: g.accessType, moduleNumber: g.moduleNumber, startsAt: g.startsAt, expiresAt: g.expiresAt, active: g.active, paymentAttemptId: g.paymentAttemptId })) };
}

async function assertClient(clientId) {
  const client = await prisma.user.findFirst({ where: { id: clientId, role: 'CLIENT' }, select: { id: true } });
  if (!client) throw notFound('Cliente no encontrado');
}

export async function grantAccess(clientId, { offerCode }) {
  await assertClient(clientId);
  const offer = await prisma.productOffer.findUnique({ where: { code: offerCode } });
  if (!offer) throw notFound('Oferta no encontrada');
  const grants = await prisma.accessGrant.findMany({ where: { userId: clientId, active: true } });
  const { startsAt, expiresAt } = grantWindow(offer, renewalBase(grants, offer));
  return prisma.accessGrant.create({
    data: { userId: clientId, offerId: offer.id, accessType: offer.type, moduleNumber: offer.moduleNumber, startsAt, expiresAt },
  });
}

export async function revokeGrant(clientId, grantId) {
  const { count } = await prisma.accessGrant.updateMany({ where: { id: grantId, userId: clientId }, data: { active: false } });
  if (!count) throw notFound('Acceso no encontrado');
}

export async function setClientActive(clientId, { isActive }) {
  await assertClient(clientId);
  return publicUser(await prisma.user.update({ where: { id: clientId }, data: { isActive } }));
}

const toAdmin = (u) => ({ ...publicUser(u), isActive: u.isActive, lastLoginAt: u.lastLoginAt });

export const listAdmins = async () => (await prisma.user.findMany({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } })).map(toAdmin);

export async function createAdmin({ name, email, password, adminLevel }) {
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('Ya existe una cuenta con ese correo');
  const user = await prisma.user.create({
    data: { name, email, role: 'ADMIN', adminLevel, passwordHash: await bcrypt.hash(password, SALT_ROUNDS) },
  });
  return publicUser(user);
}

async function assertOtherAdmin(req, adminId, message) {
  if (adminId === req.user.id) throw badRequest(message);
  const admin = await prisma.user.findFirst({ where: { id: adminId, role: 'ADMIN' }, select: { id: true } });
  if (!admin) throw notFound('Administrador no encontrado');
}

export async function setAdminActive(req, adminId, { isActive }) {
  await assertOtherAdmin(req, adminId, 'No puedes inactivar tu propia cuenta');
  return toAdmin(await prisma.user.update({ where: { id: adminId }, data: { isActive } }));
}

export async function setAdminPassword(req, adminId, { password }) {
  await assertOtherAdmin(req, adminId, 'Cambia tu propia contraseña desde Seguridad de la cuenta');
  await prisma.user.update({ where: { id: adminId }, data: { passwordHash: await bcrypt.hash(password, SALT_ROUNDS) } });
}

export async function deleteAdmin(req, adminId) {
  await assertOtherAdmin(req, adminId, 'No puedes eliminar tu propia cuenta');
  await prisma.user.delete({ where: { id: adminId } });
}

export async function setAdminLevel(req, adminId, { adminLevel }) {
  await assertOtherAdmin(req, adminId, 'No puedes cambiar tu propio nivel');
  return publicUser(await prisma.user.update({ where: { id: adminId }, data: { adminLevel } }));
}

export async function updateOffer(code, data) {
  const before = await prisma.productOffer.findUnique({ where: { code } });
  if (!before) throw notFound('Oferta no encontrada');
  const payload = { ...data, accessDays: data.accessDays ?? before.accessDays };
  const updated = await prisma.productOffer.update({ where: { code }, data: payload });
  invalidateOffersCache();
  return publicOffer(updated);
}

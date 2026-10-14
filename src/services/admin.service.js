import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { grantWindow, summarizeAccess } from '../domain/access.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { publicUser, SALT_ROUNDS } from './auth.service.js';
import { logAdminChange, logSystemChange } from './audit.service.js';
import { publicOffer } from './access.service.js';

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

export async function grantAccess(req, clientId, { offerCode, reason }) {
  await getClient(clientId);
  const offer = await prisma.productOffer.findUnique({ where: { code: offerCode } });
  if (!offer) throw notFound('Oferta no encontrada');
  const current = summarizeAccess(await prisma.accessGrant.findMany({ where: { userId: clientId, active: true } }));
  const { startsAt, expiresAt } = grantWindow(offer, current.full?.expiresAt || null);
  const grant = await prisma.accessGrant.create({
    data: { userId: clientId, offerId: offer.id, accessType: offer.type, moduleNumber: offer.moduleNumber, startsAt, expiresAt },
  });
  await logAdminChange(req, { module: 'ACCESOS', action: 'CREATE', entityId: grant.id, after: { offerCode, startsAt, expiresAt }, reason, clientId });
  return grant;
}

export async function revokeGrant(req, clientId, grantId, reason) {
  const grant = await prisma.accessGrant.findFirst({ where: { id: grantId, userId: clientId } });
  if (!grant) throw notFound('Acceso no encontrado');
  await prisma.accessGrant.update({ where: { id: grantId }, data: { active: false } });
  await logAdminChange(req, { module: 'ACCESOS', action: 'UPDATE', entityId: grantId, before: { active: true }, after: { active: false }, reason, clientId });
}

export async function setClientActive(req, clientId, { isActive, reason }) {
  const before = await getClient(clientId);
  const after = await prisma.user.update({ where: { id: clientId }, data: { isActive } });
  await logAdminChange(req, { module: 'USUARIOS', action: 'UPDATE', entityId: clientId, before: { isActive: before.isActive }, after: { isActive: after.isActive }, reason, clientId });
  return publicUser(after);
}

export async function listAudit({ clientId, page = 1 }) {
  const take = 50;
  const where = clientId ? { clientId } : {};
  const [items, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * take,
      take,
      include: { admin: { select: { name: true, email: true } }, client: { select: { name: true, email: true } } },
    }),
    prisma.adminAuditLog.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / take)) };
}

export const listAdmins = async () => (await prisma.user.findMany({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } })).map(publicUser);

export async function createAdmin(adminId, { name, email, password, adminLevel }) {
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('Ya existe una cuenta con ese correo');
  const user = await prisma.user.create({
    data: { name, email, role: 'ADMIN', adminLevel, passwordHash: await bcrypt.hash(password, SALT_ROUNDS) },
  });
  await logSystemChange(adminId, { module: 'ADMINISTRADORES', action: 'CREATE', entityId: user.id, after: { email, adminLevel } });
  return publicUser(user);
}

export async function setAdminLevel(req, adminId, { adminLevel, reason }) {
  if (adminId === req.user.id) throw badRequest('No puedes cambiar tu propio nivel');
  const admin = await prisma.user.findFirst({ where: { id: adminId, role: 'ADMIN' } });
  if (!admin) throw notFound('Administrador no encontrado');
  const updated = await prisma.user.update({ where: { id: adminId }, data: { adminLevel } });
  await logSystemChange(req.user.id, { module: 'ADMINISTRADORES', action: 'UPDATE', entityId: adminId, before: { adminLevel: admin.adminLevel }, after: { adminLevel }, reason });
  return publicUser(updated);
}

export async function updateOffer(adminId, code, data) {
  const before = await prisma.productOffer.findUnique({ where: { code } });
  if (!before) throw notFound('Oferta no encontrada');
  const payload = { ...data, accessDays: before.type === 'FULL_ANNUAL' ? data.accessDays ?? before.accessDays : null };
  const updated = await prisma.productOffer.update({ where: { code }, data: payload });
  await logSystemChange(adminId, { module: 'PRECIOS', action: 'UPDATE', entityId: code, before: publicOffer(before), after: publicOffer(updated) });
  return publicOffer(updated);
}

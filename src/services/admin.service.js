import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { getPlan } from '../config/plans.js';
import { addMonths } from '../domain/subscription.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { describeSubscription } from './subscription.service.js';
import { publicUser, SALT_ROUNDS } from './auth.service.js';
import { logAdminChange } from './audit.service.js';

const clientSelect = {
  id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true,
  subscription: true,
  _count: { select: { periods: true, monthlyCloses: true, appointments: true } },
};

const toClient = ({ subscription, _count, ...u }) => ({ ...u, counts: _count, ...describeSubscription(subscription) });

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
  return toClient(row);
}

// Cambio manual de membresía (cortesía/corrección). Queda en bitácora con motivo.
export async function setSubscriptionStatus(req, clientId, { status, reason }) {
  await getClient(clientId);
  return prisma.$transaction(async (tx) => {
    const before = await tx.subscription.findUnique({ where: { userId: clientId } });
    const now = new Date();
    const data = { status };
    if (status === 'ACTIVE') {
      data.activatedAt = before?.activatedAt || now;
      data.startDate = before?.startDate || now;
      data.cancelledAt = null;
      if (!before?.nextBillingDate || before.nextBillingDate < now) data.nextBillingDate = addMonths(now, 1);
    }
    if (status === 'CANCELLED') data.cancelledAt = now;
    const plan = getPlan();
    const after = await tx.subscription.upsert({
      where: { userId: clientId },
      create: { userId: clientId, plan: plan.code, amount: plan.amount ?? 0, currency: plan.currency, ...data },
      update: data,
    });
    await logAdminChange(req, { module: 'SUSCRIPCION', action: 'UPDATE', entityId: after.id, before, after, reason, clientId }, tx);
    return describeSubscription(after);
  });
}

export async function setClientActive(req, clientId, { isActive, reason }) {
  const before = await getClient(clientId);
  const after = await prisma.user.update({ where: { id: clientId }, data: { isActive } });
  await logAdminChange(req, {
    module: 'USUARIOS', action: 'UPDATE', entityId: clientId,
    before: { isActive: before.isActive }, after: { isActive: after.isActive }, reason, clientId,
  });
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

export const listAdmins = async () =>
  (await prisma.user.findMany({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } })).map(publicUser);

export async function createAdmin({ name, email, password, adminLevel }) {
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('Ya existe una cuenta con ese correo');
  const user = await prisma.user.create({
    data: { name, email, role: 'ADMIN', adminLevel, passwordHash: await bcrypt.hash(password, SALT_ROUNDS) },
  });
  return publicUser(user);
}

export async function setAdminLevel(req, adminId, { adminLevel }) {
  if (adminId === req.user.id) throw badRequest('No puedes cambiar tu propio nivel');
  const admin = await prisma.user.findFirst({ where: { id: adminId, role: 'ADMIN' } });
  if (!admin) throw notFound('Administrador no encontrado');
  return publicUser(await prisma.user.update({ where: { id: adminId }, data: { adminLevel } }));
}

export async function stats() {
  const [clients, active, pendingAppointments, closes] = await Promise.all([
    prisma.user.count({ where: { role: 'CLIENT' } }),
    prisma.subscription.count({ where: { status: 'ACTIVE' } }),
    prisma.appointment.count({ where: { status: 'PENDING' } }),
    prisma.monthlyClose.count({ where: { supersededAt: null } }),
  ]);
  return { clients, active, pendingAppointments, closes };
}

import { prisma } from '../config/prisma.js';
import { forbidden, notFound } from '../utils/httpError.js';

const view = (share) => share && { id: share.id, grantedAt: share.grantedAt, endedAt: share.endedAt };

export const activeShare = (clientId, db = prisma) => db.dataShare.findFirst({ where: { clientId, endedAt: null }, orderBy: { grantedAt: 'desc' } });

export async function shareStatus(user) {
  if (user.role !== 'CLIENT') throw forbidden('Solo el cliente puede compartir sus datos');
  return { active: view(await activeShare(user.id)) };
}

export async function startShare(user) {
  if (user.role !== 'CLIENT') throw forbidden('Solo el cliente puede compartir sus datos');
  const current = await activeShare(user.id);
  if (current) return { active: view(current) };
  return { active: view(await prisma.dataShare.create({ data: { clientId: user.id } })) };
}

async function endShare(clientId, endedById, endedByRole) {
  await prisma.dataShare.updateMany({ where: { clientId, endedAt: null }, data: { endedAt: new Date(), endedById, endedByRole } });
}

export async function stopShareByClient(user) {
  if (user.role !== 'CLIENT') throw forbidden('Solo el cliente puede dejar de compartir sus datos');
  await endShare(user.id, user.id, 'CLIENT');
  return { active: null };
}

export async function stopShareByAdmin(admin, clientId) {
  const client = await prisma.user.findFirst({ where: { id: clientId, role: 'CLIENT' }, select: { id: true } });
  if (!client) throw notFound('Cliente no encontrado');
  await endShare(clientId, admin.id, 'ADMIN');
  return { active: null };
}

export async function assertShared(clientId) {
  if (!(await activeShare(clientId))) throw forbidden('El cliente no ha autorizado compartir sus datos, o ya dejó de compartirlos.');
}

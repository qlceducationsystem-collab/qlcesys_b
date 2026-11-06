import { prisma } from '../config/prisma.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import { actorOf, recordEvent } from './adminEvent.service.js';

const view = (share) => share && { id: share.id, grantedAt: share.grantedAt, endedAt: share.endedAt, allowEdit: share.allowEdit, editGrantedAt: share.editGrantedAt };

export const activeShare = (clientId, db = prisma) => db.dataShare.findFirst({ where: { clientId, endedAt: null }, orderBy: { grantedAt: 'desc' } });

export async function shareStatus(user) {
  if (user.role !== 'CLIENT') throw forbidden('Solo el cliente puede compartir sus datos');
  return { active: view(await activeShare(user.id)) };
}

export async function startShare(user) {
  if (user.role !== 'CLIENT') throw forbidden('Solo el cliente puede compartir sus datos');
  const current = await activeShare(user.id);
  if (current) return { active: view(current) };
  const share = await prisma.dataShare.create({ data: { clientId: user.id } });
  recordEvent({ category: 'PLATAFORMA', type: 'DATOS_COMPARTIDOS', actor: actorOf(user), user, status: 'Compartiendo datos' }).catch(() => null);
  return { active: view(share) };
}

export async function setShareEdit(user, allow) {
  if (user.role !== 'CLIENT') throw forbidden('Solo el cliente puede autorizar cambios en sus datos');
  const current = await activeShare(user.id);
  if (!allow) {
    if (!current) return { active: null };
    return { active: view(await prisma.dataShare.update({ where: { id: current.id }, data: { allowEdit: false, editGrantedAt: null } })) };
  }
  if (current?.allowEdit) return { active: view(current) };
  const data = { allowEdit: true, editGrantedAt: new Date() };
  const share = current ? await prisma.dataShare.update({ where: { id: current.id }, data }) : await prisma.dataShare.create({ data: { clientId: user.id, ...data } });
  recordEvent({ category: 'PLATAFORMA', type: 'EDICION_AUTORIZADA', actor: actorOf(user), user, status: 'Puede modificar sus datos' }).catch(() => null);
  return { active: view(share) };
}

async function endShare(clientId, endedById, endedByRole) {
  await prisma.$transaction(async (tx) => {
    const open = await tx.dataShare.findMany({ where: { clientId, endedAt: null }, select: { id: true } });
    await tx.shareMessage.deleteMany({ where: { shareId: { in: open.map((s) => s.id) } } });
    await tx.dataShare.updateMany({ where: { clientId, endedAt: null }, data: { endedAt: new Date(), endedById, endedByRole } });
  });
}

const messageView = (m) => ({ id: m.id, senderRole: m.senderRole, senderName: m.senderRole === 'ADMIN' ? 'Asesor QLC' : m.senderName, body: m.body, createdAt: m.createdAt });

async function shareFor(clientId) {
  const share = await activeShare(clientId);
  if (!share) throw forbidden('El chat se cerró porque ya no se están compartiendo los datos.');
  return share;
}

export async function listMessages(clientId) {
  const share = await shareFor(clientId);
  const rows = await prisma.shareMessage.findMany({ where: { shareId: share.id }, orderBy: { createdAt: 'asc' }, take: 500 });
  return { shareId: share.id, messages: rows.map(messageView) };
}

export async function sendMessage(user, clientId, text) {
  const body = String(text || '').trim();
  if (!body) throw badRequest('Escribe un mensaje');
  if (body.length > 2000) throw badRequest('El mensaje es demasiado largo');
  const share = await shareFor(clientId);
  return messageView(await prisma.shareMessage.create({ data: { shareId: share.id, senderId: user.id, senderRole: user.role, senderName: user.name || '', body } }));
}

const clientOnly = (user) => {
  if (user.role !== 'CLIENT') throw forbidden('Solo el cliente puede usar este chat');
};

export const clientMessages = (user) => {
  clientOnly(user);
  return listMessages(user.id);
};

export const clientSend = (user, text) => {
  clientOnly(user);
  return sendMessage(user, user.id, text);
};

export const adminMessages = (clientId) => listMessages(clientId);

export const adminSend = (admin, clientId, text) => sendMessage(admin, clientId, text);

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
  const share = await activeShare(clientId);
  if (!share) throw forbidden('El cliente no ha autorizado compartir sus datos, o ya dejó de compartirlos.');
  return share;
}

import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { num } from '../utils/money.js';
import { sendEmail } from './email.service.js';

export const EVENT_LABELS = {
  CONTRATADA: 'Suscripción contratada',
  ACTIVADA: 'Suscripción activada',
  RENOVADA: 'Suscripción renovada',
  VENCIDA: 'Suscripción vencida',
  CANCELADA: 'Suscripción cancelada',
  PAGO_FALLIDO: 'Pago fallido',
  RECUPERADA: 'Suscripción recuperada',
  IMPORTE_NO_COINCIDE: 'Pago con importe distinto al esperado',
  PROMOCION_CREADA: 'Promoción creada',
  PROMOCION_ENVIADA: 'Promoción enviada por correo',
  PROMOCION_CANCELADA: 'Promoción cancelada',
  PAGO_PROMOCIONAL: 'Pago promocional confirmado',
  ACCESO_CONCEDIDO: 'Acceso concedido',
  VENCIMIENTO_MODIFICADO: 'Vencimiento modificado',
  ACCESO_RETIRADO: 'Acceso retirado',
  ACCESO_AUTORIZADO: 'Acceso promocional autorizado',
  AUTORIZACION_RECHAZADA: 'Pago promocional no autorizado',
  CONTRASENA_MAESTRA: 'Contraseña maestra configurada',
  CONTRASENA_MAESTRA_CAMBIADA: 'Contraseña maestra actualizada',
  AUTORIZACION_FALLIDA: 'Intento de autorización fallido',
  REGALO_COMPRADO: 'Regalo comprado',
  REGALO_CANJEADO: 'Regalo canjeado',
  REGALO_CANCELADO: 'Regalo cancelado',
};

const NOTIFY = new Set(['CONTRATADA', 'ACTIVADA', 'RENOVADA', 'VENCIDA', 'CANCELADA', 'PAGO_FALLIDO', 'RECUPERADA', 'IMPORTE_NO_COINCIDE', 'PAGO_PROMOCIONAL', 'REGALO_COMPRADO', 'REGALO_CANJEADO']);

export const periodOf = (offer) => {
  if (!offer) return null;
  const days = offer.accessDays || (offer.type === 'FULL_ANNUAL' ? 365 : 30);
  return days >= 365 ? 'ANUAL' : days >= 28 && days <= 31 ? 'MENSUAL' : `${days} DÍAS`;
};

export const actorOf = (user) => (user ? { actorType: user.role === 'ADMIN' ? 'ADMIN' : 'CLIENTE', actorId: user.id, actorName: user.name || user.email } : { actorType: 'SISTEMA', actorId: null, actorName: 'Sistema' });
export const GATEWAY = { actorType: 'PASARELA', actorId: null, actorName: 'Pasarela de pago' };
export const SYSTEM = { actorType: 'SISTEMA', actorId: null, actorName: 'Sistema' };

const eventView = (e) => ({
  id: e.id,
  category: e.category,
  type: e.type,
  label: EVENT_LABELS[e.type] || e.type,
  actorType: e.actorType,
  actorName: e.actorName,
  userId: e.userId,
  userName: e.userName,
  userEmail: e.userEmail,
  product: e.product,
  period: e.period,
  status: e.status,
  amount: e.amount === null ? null : num(e.amount),
  result: e.result,
  details: e.details,
  createdAt: e.createdAt,
});

async function recipients() {
  if (env.adminNotifyEmails.length) return env.adminNotifyEmails;
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', adminLevel: 'FULL', isActive: true }, select: { email: true } });
  return admins.map((a) => a.email);
}

async function notify(event) {
  if (!NOTIFY.has(event.type)) return;
  const to = await recipients();
  for (const address of to) await sendEmail('adminEvent', address, eventView(event));
}

export async function recordEvent({ category, type, actor = SYSTEM, user = null, offer = null, status = null, amount = null, result = null, details = null }, db = prisma) {
  const event = await db.adminEvent.create({
    data: {
      category,
      type,
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorName: actor.actorName,
      userId: user?.id || null,
      userName: user?.name || null,
      userEmail: user?.email || null,
      product: offer?.name || null,
      period: periodOf(offer),
      status,
      amount: amount === null || amount === undefined ? null : amount,
      result,
      details,
    },
  });
  if (db === prisma) notify(event).catch((err) => console.error('[qlc] aviso al administrador', err.message));
  return event;
}

export const notifyEvent = (event) => notify(event).catch((err) => console.error('[qlc] aviso al administrador', err.message));

export async function listEvents({ category, userId, type, take = 300 } = {}) {
  const rows = await prisma.adminEvent.findMany({
    where: { ...(category ? { category } : {}), ...(userId ? { userId } : {}), ...(type ? { type } : {}) },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(take) || 300, 1000),
  });
  return rows.map(eventView);
}

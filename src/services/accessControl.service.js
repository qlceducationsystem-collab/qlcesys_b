import { prisma } from '../config/prisma.js';
import { grantWindow, isGrantActive, renewalBase } from '../domain/access.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { num } from '../utils/money.js';
import { actorOf, recordEvent } from './adminEvent.service.js';
import { sendClientEmail } from './email.service.js';
import { assertMaster } from './master.service.js';
import { cancelUserSubscriptions } from './subscription.service.js';

export const GRANT_REASONS = {
  CORTESIA: 'Cortesía',
  BENEFICIO: 'Beneficio especial',
  PROMOCION: 'Promoción comercial',
  COMPENSACION: 'Compensación al cliente',
  INVITACION: 'Invitación',
  ESPECIAL: 'Autorización especial',
};

const SOURCES = { PAGO: 'Pago', MANUAL: 'Manual', REGALO: 'Regalo', PROMOCION: 'Pago promocional' };

const day = (d) => new Date(d).toISOString().slice(0, 10);

const grantView = (g, admins = new Map()) => ({
  id: g.id,
  offer: g.offer?.name,
  offerCode: g.offer?.code,
  accessType: g.accessType,
  startsAt: g.startsAt,
  expiresAt: g.expiresAt,
  active: g.active,
  current: isGrantActive(g),
  source: g.source,
  sourceLabel: SOURCES[g.source] || g.source,
  reason: g.reason,
  grantedBy: g.grantedById ? admins.get(g.grantedById) || null : null,
  revokedAt: g.revokedAt,
  revokedBy: g.revokedById ? admins.get(g.revokedById) || null : null,
  createdAt: g.createdAt,
});

async function adminNames(grants) {
  const ids = [...new Set(grants.flatMap((g) => [g.grantedById, g.revokedById]).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function searchUsers(q = '') {
  const term = String(q || '').trim();
  const users = await prisma.user.findMany({
    where: { role: 'CLIENT', ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }] } : {}) },
    select: { id: true, name: true, email: true, isActive: true, accessGrants: { include: { offer: true }, orderBy: { createdAt: 'desc' } } },
    orderBy: { name: 'asc' },
    take: term ? 50 : 30,
  });
  const names = await adminNames(users.flatMap((u) => u.accessGrants));
  return users.map((u) => ({ id: u.id, name: u.name, email: u.email, isActive: u.isActive, grants: u.accessGrants.map((g) => grantView(g, names)) }));
}

const future = (value, label) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`Indique una ${label} válida`);
  if (d <= new Date()) throw badRequest(`La ${label} debe ser posterior a este momento`);
  return d;
};

export async function grantManual(admin, { userId, offerCode, expiresAt, reason, note, masterPassword, code }) {
  await assertMaster(admin, { masterPassword, code });
  const [user, offer] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, role: 'CLIENT' } }),
    prisma.productOffer.findUnique({ where: { code: offerCode } }),
  ]);
  if (!user) throw notFound('Usuario no encontrado');
  if (!offer) throw notFound('Producto no encontrado');
  const until = future(expiresAt, 'fecha de vencimiento');
  const label = `${GRANT_REASONS[reason] || 'Autorización especial'}${note ? ` · ${note}` : ''}`;
  const grant = await prisma.accessGrant.create({
    data: { userId, offerId: offer.id, accessType: offer.type, moduleNumber: offer.moduleNumber, startsAt: new Date(), expiresAt: until, source: 'MANUAL', reason: label, grantedById: admin.id },
    include: { offer: true },
  });
  if (offer.sessions > 0) await prisma.serviceCredit.createMany({ data: Array.from({ length: offer.sessions }, () => ({ userId, kind: 'ORIENTACION', source: 'MANUAL', grantId: grant.id, expiresAt: until })) });
  await prisma.user.update({ where: { id: userId }, data: { subscriptionCancelledAt: null, retentionStage: 0 } });
  sendClientEmail('ACCESO_ACTIVADO', 'accessActivated', user.email, { name: user.name, product: offer.name, expiresAt: until }).catch(() => null);
  await recordEvent({ category: 'ACCESO', type: 'ACCESO_CONCEDIDO', actor: actorOf(admin), user, offer, status: 'Activo', result: `Autorizado hasta ${day(until)} · ${label}` });
  return grantView(grant, new Map([[admin.id, admin.name]]));
}

async function ownedGrant(id) {
  const grant = await prisma.accessGrant.findUnique({ where: { id }, include: { offer: true, user: true } });
  if (!grant) throw notFound('Acceso no encontrado');
  return grant;
}

export async function changeExpiry(admin, id, { expiresAt, note, masterPassword, code }) {
  await assertMaster(admin, { masterPassword, code });
  const grant = await ownedGrant(id);
  if (!grant.active) throw badRequest('Este acceso fue retirado; conceda uno nuevo si lo necesita');
  const until = new Date(expiresAt);
  if (Number.isNaN(until.getTime()) || until <= new Date(grant.startsAt)) throw badRequest('La nueva fecha debe ser posterior al inicio del acceso');
  const updated = await prisma.accessGrant.update({ where: { id }, data: { expiresAt: until, expiryNotifiedAt: null }, include: { offer: true } });
  await recordEvent({
    category: 'ACCESO', type: 'VENCIMIENTO_MODIFICADO', actor: actorOf(admin), user: grant.user, offer: grant.offer, status: until > new Date() ? 'Activo' : 'Vencido',
    result: `De ${grant.expiresAt ? day(grant.expiresAt) : 'sin vencimiento'} a ${day(until)}${note ? ` · ${note}` : ''}`,
  });
  return grantView(updated);
}

export async function revokeManual(admin, id, { note, masterPassword, code }) {
  await assertMaster(admin, { masterPassword, code });
  const grant = await ownedGrant(id);
  if (!grant.active) throw badRequest('Este acceso ya estaba retirado');
  await cancelUserSubscriptions(grant.userId, { offerId: grant.offerId });
  const updated = await prisma.accessGrant.update({ where: { id }, data: { active: false, revokedAt: new Date(), revokedById: admin.id }, include: { offer: true } });
  await recordEvent({ category: 'ACCESO', type: 'ACCESO_RETIRADO', actor: actorOf(admin), user: grant.user, offer: grant.offer, status: 'Desactivado', result: note || 'Retiro manual' });
  return grantView(updated);
}

const pendingView = (a) => ({
  id: a.id,
  amount: a.amount === null ? null : num(a.amount),
  currency: a.currency,
  resolvedAt: a.resolvedAt,
  createdAt: a.createdAt,
  user: { id: a.user.id, name: a.user.name, email: a.user.email },
  offer: { code: a.offer.code, name: a.offer.name, accessDays: a.offer.accessDays, type: a.offer.type },
  promotion: a.promotion ? { code: a.promotion.code, discountPercent: a.promotion.discountPercent } : null,
  authorization: a.authorization,
});

export async function pendingAuthorizations() {
  const rows = await prisma.paymentAttempt.findMany({
    where: { kind: 'PROMO', status: 'APPROVED', authorization: 'PENDING' },
    include: { user: true, offer: true, promotion: true },
    orderBy: { resolvedAt: 'asc' },
  });
  return rows.map(pendingView);
}

async function pendingAttempt(id) {
  const attempt = await prisma.paymentAttempt.findUnique({ where: { id }, include: { user: true, offer: true, promotion: true } });
  if (!attempt || attempt.kind !== 'PROMO' || attempt.status !== 'APPROVED' || attempt.authorization !== 'PENDING') throw notFound('No hay un pago promocional pendiente de autorización con esa referencia');
  return attempt;
}

export async function authorizePromo(admin, id, { expiresAt, masterPassword, code }) {
  await assertMaster(admin, { masterPassword, code });
  const attempt = await pendingAttempt(id);
  const grants = await prisma.accessGrant.findMany({ where: { userId: attempt.userId, active: true } });
  const window = grantWindow(attempt.offer, renewalBase(grants, attempt.offer));
  const until = expiresAt ? future(expiresAt, 'fecha de vencimiento') : window.expiresAt;
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.paymentAttempt.updateMany({ where: { id, authorization: 'PENDING' }, data: { authorization: 'AUTHORIZED', authorizedAt: new Date(), authorizedById: admin.id } });
    if (!claimed.count) throw badRequest('Este pago ya fue atendido');
    const grant = await tx.accessGrant.create({
      data: {
        userId: attempt.userId, offerId: attempt.offerId, paymentAttemptId: attempt.id, accessType: attempt.offer.type, moduleNumber: attempt.offer.moduleNumber,
        startsAt: expiresAt ? new Date() : window.startsAt, expiresAt: until, source: 'PROMOCION', reason: attempt.promotion ? `Promoción ${attempt.promotion.code} · ${attempt.promotion.discountPercent}%` : 'Pago promocional', grantedById: admin.id,
      },
    });
    if (attempt.offer.sessions > 0) await tx.serviceCredit.createMany({ data: Array.from({ length: attempt.offer.sessions }, () => ({ userId: attempt.userId, kind: 'ORIENTACION', source: 'PROMOCION', grantId: grant.id, paymentAttemptId: attempt.id, expiresAt: until })) });
    await tx.user.update({ where: { id: attempt.userId }, data: { subscriptionCancelledAt: null, retentionStage: 0 } });
    return grant;
  });
  sendClientEmail('ACCESO_ACTIVADO', 'accessActivated', attempt.user.email, { name: attempt.user.name, product: attempt.offer.name, expiresAt: until }).catch(() => null);
  await recordEvent({ category: 'ACCESO', type: 'ACCESO_AUTORIZADO', actor: actorOf(admin), user: attempt.user, offer: attempt.offer, status: 'Activo', amount: attempt.amount, result: `Autorizado hasta ${day(until)}` });
  await recordEvent({ category: 'SUSCRIPCION', type: 'RECUPERADA', actor: actorOf(admin), user: attempt.user, offer: attempt.offer, status: 'Activo', amount: attempt.amount, result: 'Recuperado con promoción' });
  return { id: result.id, expiresAt: until };
}

export async function rejectPromo(admin, id, { note, masterPassword, code }) {
  await assertMaster(admin, { masterPassword, code });
  const attempt = await pendingAttempt(id);
  await prisma.paymentAttempt.update({ where: { id }, data: { authorization: 'REJECTED', authorizedAt: new Date(), authorizedById: admin.id } });
  await recordEvent({ category: 'ACCESO', type: 'AUTORIZACION_RECHAZADA', actor: actorOf(admin), user: attempt.user, offer: attempt.offer, status: 'Sin acceso', amount: attempt.amount, result: note || 'No autorizado' });
  return { ok: true };
}

import crypto from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { grantWindow, renewalBase } from '../domain/access.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/httpError.js';
import { actorOf, notifyEvent, recordEvent } from './adminEvent.service.js';
import { sendClientEmail } from './email.service.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const block = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('');
export const newCode = (prefix) => `${prefix}-${block(4)}-${block(4)}`;
export const normalizeCode = (code) => String(code || '').trim().toUpperCase().replace(/\s+/g, '');

export const GIFT_DEFAULTS = { redeemDays: 365 };

export async function getSetting(key, defaults) {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return { ...defaults, ...(row?.value || {}) };
}

export async function giftSettings() {
  return getSetting('gifts', GIFT_DEFAULTS);
}

export async function saveGiftSettings({ redeemDays }) {
  const value = { redeemDays };
  await prisma.appSetting.upsert({ where: { key: 'gifts' }, create: { key: 'gifts', value }, update: { value } });
  return giftSettings();
}

export const giftStatus = (g, now = new Date()) => (g.status === 'DISPONIBLE' && new Date(g.redeemBy) <= now ? 'VENCIDO' : g.status);

const durationOf = (offer) => {
  const days = offer.accessDays || (offer.type === 'FULL_ANNUAL' ? 365 : 30);
  return days >= 365 ? 'Anual' : days >= 28 && days <= 31 ? 'Mensual' : `${days} días`;
};

const giftView = (g) => ({
  id: g.id,
  code: g.code,
  product: g.offer?.name,
  offerCode: g.offer?.code,
  duration: g.offer ? durationOf(g.offer) : null,
  accessDays: g.offer?.accessDays ?? null,
  status: giftStatus(g),
  message: g.message,
  recipientName: g.recipientName,
  purchaser: g.purchaser ? { id: g.purchaser.id, name: g.purchaser.name, email: g.purchaser.email } : undefined,
  recipient: g.recipient ? { id: g.recipient.id, name: g.recipient.name, email: g.recipient.email } : null,
  createdAt: g.createdAt,
  redeemBy: g.redeemBy,
  activatedAt: g.activatedAt,
  expiresAt: g.grant?.expiresAt ?? null,
});

const include = { offer: true, grant: true, purchaser: { select: { id: true, name: true, email: true } }, recipient: { select: { id: true, name: true, email: true } } };

export async function createGiftCodes(tx, attempt) {
  const { redeemDays } = await giftSettings();
  const redeemBy = new Date(Date.now() + redeemDays * 86400000);
  const codes = [];
  for (let i = 0; i < attempt.quantity; i += 1) {
    let code = newCode('QLC');
    while (await tx.giftCode.findUnique({ where: { code } })) code = newCode('QLC');
    await tx.giftCode.create({
      data: { code, offerId: attempt.offerId, purchaserId: attempt.userId, paymentAttemptId: attempt.id, message: attempt.giftMessage, recipientName: attempt.giftRecipientName, redeemBy },
    });
    codes.push(code);
  }
  return { codes, redeemBy };
}

export async function emailGiftCodes(userId, offer, codes, redeemBy) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  if (user) await sendClientEmail('CODIGOS_REGALO', 'giftCodes', user.email, { name: user.name, product: offer.name, codes, redeemBy });
}

export async function myGifts(userId) {
  return (await prisma.giftCode.findMany({ where: { purchaserId: userId }, include, orderBy: { createdAt: 'desc' } })).map((g) => {
    const v = giftView(g);
    return { ...v, purchaser: undefined, recipient: v.recipient ? { name: v.recipient.name } : null };
  });
}

export async function previewGift(code) {
  const gift = await prisma.giftCode.findUnique({ where: { code: normalizeCode(code) }, include: { offer: true } });
  if (!gift) throw notFound('No encontramos ese código de regalo. Revisa que esté escrito correctamente.');
  const status = giftStatus(gift);
  return {
    code: gift.code,
    status,
    product: gift.offer.name,
    description: gift.offer.description,
    duration: durationOf(gift.offer),
    accessDays: gift.offer.accessDays,
    message: status === 'DISPONIBLE' ? gift.message : null,
    recipientName: status === 'DISPONIBLE' ? gift.recipientName : null,
    redeemBy: gift.redeemBy,
  };
}

export async function redeemGift(user, code) {
  if (user.role !== 'CLIENT') throw forbidden('Los regalos se canjean desde una cuenta de cliente');
  const normalized = normalizeCode(code);
  const result = await prisma.$transaction(async (tx) => {
    const gift = await tx.giftCode.findUnique({ where: { code: normalized }, include: { offer: true, purchaser: { select: { name: true, email: true } } } });
    if (!gift) throw notFound('No encontramos ese código de regalo. Revisa que esté escrito correctamente.');
    const status = giftStatus(gift);
    if (status === 'ACTIVADO') throw conflict('Este código de regalo ya fue utilizado');
    if (status === 'VENCIDO') throw conflict('Este código de regalo venció y ya no puede canjearse');
    if (status === 'CANCELADO') throw conflict('Este código de regalo fue cancelado');
    const claimed = await tx.giftCode.updateMany({ where: { id: gift.id, status: 'DISPONIBLE' }, data: { status: 'ACTIVADO', recipientId: user.id, activatedAt: new Date() } });
    if (!claimed.count) throw conflict('Este código de regalo ya fue utilizado');
    const grants = await tx.accessGrant.findMany({ where: { userId: user.id, active: true } });
    const { startsAt, expiresAt } = grantWindow(gift.offer, renewalBase(grants, gift.offer));
    const grant = await tx.accessGrant.create({
      data: { userId: user.id, offerId: gift.offerId, accessType: gift.offer.type, moduleNumber: gift.offer.moduleNumber, startsAt, expiresAt, source: 'REGALO', reason: `Código de regalo ${gift.code}` },
    });
    await tx.giftCode.update({ where: { id: gift.id }, data: { grantId: grant.id } });
    if (gift.offer.sessions > 0) await tx.serviceCredit.createMany({ data: Array.from({ length: gift.offer.sessions }, () => ({ userId: user.id, kind: 'ORIENTACION', source: 'REGALO', grantId: grant.id, expiresAt })) });
    await tx.user.update({ where: { id: user.id }, data: { subscriptionCancelledAt: null, retentionStage: 0 } });
    const event = await recordEvent({ category: 'REGALO', type: 'REGALO_CANJEADO', actor: actorOf(user), user, offer: gift.offer, status: 'Activo', result: `Código ${gift.code} · vence ${expiresAt.toISOString().slice(0, 10)}` }, tx);
    return { event, product: gift.offer.name, startsAt, expiresAt, purchaser: gift.purchaser, recipientName: gift.recipientName };
  });
  notifyEvent(result.event);
  sendClientEmail('ACCESO_ACTIVADO', 'accessActivated', user.email, { name: user.name, product: result.product, expiresAt: result.expiresAt }).catch(() => null);
  if (result.purchaser) sendClientEmail('REGALO_ACTIVADO', 'giftRedeemed', result.purchaser.email, { name: result.purchaser.name, product: result.product, recipient: result.recipientName || user.name }).catch(() => null);
  return { product: result.product, startsAt: result.startsAt, expiresAt: result.expiresAt };
}

export async function listGifts({ status } = {}) {
  const rows = await prisma.giftCode.findMany({ include, orderBy: { createdAt: 'desc' }, take: 500 });
  const list = rows.map(giftView);
  return status ? list.filter((g) => g.status === status) : list;
}

export async function cancelGift(admin, id) {
  const gift = await prisma.giftCode.findUnique({ where: { id }, include: { offer: true, purchaser: true } });
  if (!gift) throw notFound('Código no encontrado');
  if (giftStatus(gift) !== 'DISPONIBLE') throw badRequest('Solo se pueden cancelar códigos disponibles');
  await prisma.giftCode.update({ where: { id }, data: { status: 'CANCELADO', cancelledAt: new Date(), cancelledById: admin.id } });
  await recordEvent({ category: 'REGALO', type: 'REGALO_CANCELADO', actor: actorOf(admin), user: gift.purchaser, offer: gift.offer, status: 'Cancelado', result: `Código ${gift.code}` });
  return { ok: true };
}

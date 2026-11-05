import { prisma } from '../config/prisma.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { num, round2 } from '../utils/money.js';
import { actorOf, recordEvent } from './adminEvent.service.js';
import { sendClientEmail } from './email.service.js';
import { newCode, normalizeCode } from './gift.service.js';

export const promoStatus = (p, now = new Date()) => (p.status === 'ACTIVA' && new Date(p.validUntil) <= now ? 'VENCIDA' : p.status);

export const promoPrice = (offer, percent) => (offer.price === null ? null : round2((num(offer.price) * (100 - percent)) / 100));

const view = (p) => ({
  id: p.id,
  code: p.code,
  discountPercent: p.discountPercent,
  validUntil: p.validUntil,
  message: p.message,
  status: promoStatus(p),
  createdByName: p.createdByName,
  emailedAt: p.emailedAt,
  usedAt: p.usedAt,
  createdAt: p.createdAt,
  user: p.user ? { id: p.user.id, name: p.user.name, email: p.user.email, marketingOptOut: p.user.marketingOptOut } : undefined,
  offer: p.offer ? { code: p.offer.code, name: p.offer.name, price: p.offer.price === null ? null : num(p.offer.price) } : undefined,
  finalPrice: p.offer ? promoPrice(p.offer, p.discountPercent) : null,
  authorization: p.attempt?.authorization || null,
});

const include = { user: { select: { id: true, name: true, email: true, marketingOptOut: true } }, offer: true, attempt: true };

export async function listPromotions({ userId } = {}) {
  return (await prisma.promotion.findMany({ where: userId ? { userId } : {}, include, orderBy: { createdAt: 'desc' }, take: 300 })).map(view);
}

async function emailPromotion(promo) {
  if (promo.user.marketingOptOut) throw conflict('Este usuario pidió no recibir promociones por correo. Puedes compartirle el código por otro medio.');
  const sent = await sendClientEmail('PROMOCION', 'promotion', promo.user.email, {
    name: promo.user.name,
    discount: promo.discountPercent,
    product: promo.offer.name,
    code: promo.code,
    validUntil: promo.validUntil,
    message: promo.message,
  });
  if (sent.skipped) throw conflict('Los correos de promociones a clientes están desactivados en Integraciones. Puedes compartir el código por otro medio.');
  if (!sent.sent) throw badRequest('No se pudo enviar el correo. Revisa que Gmail esté conectado en Integraciones.');
  return prisma.promotion.update({ where: { id: promo.id }, data: { emailedAt: new Date() }, include });
}

export async function createPromotion(admin, { userId, offerCode, discountPercent, validUntil, message, send }) {
  const [user, offer] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, role: 'CLIENT' } }),
    prisma.productOffer.findUnique({ where: { code: offerCode } }),
  ]);
  if (!user) throw notFound('Usuario no encontrado');
  if (!offer) throw notFound('Producto no encontrado');
  if (offer.price === null) throw badRequest('Este producto todavía no tiene precio definido');
  if (new Date(validUntil) <= new Date()) throw badRequest('La vigencia debe ser una fecha futura');
  let code = newCode('PROMO');
  while (await prisma.promotion.findUnique({ where: { code } })) code = newCode('PROMO');
  let promo = await prisma.promotion.create({
    data: { code, userId, offerId: offer.id, discountPercent, validUntil: new Date(validUntil), message: message || null, createdById: admin.id, createdByName: admin.name || admin.email },
    include,
  });
  await recordEvent({ category: 'PROMOCION', type: 'PROMOCION_CREADA', actor: actorOf(admin), user, offer, status: `${discountPercent}% de descuento`, amount: promoPrice(offer, discountPercent), result: `Código ${code}` });
  if (send) {
    promo = await emailPromotion(promo);
    await recordEvent({ category: 'PROMOCION', type: 'PROMOCION_ENVIADA', actor: actorOf(admin), user, offer, status: `${discountPercent}% de descuento`, result: `Código ${code}` });
  }
  return view(promo);
}

export async function sendPromotion(admin, id) {
  const promo = await prisma.promotion.findUnique({ where: { id }, include });
  if (!promo) throw notFound('Promoción no encontrada');
  if (promoStatus(promo) !== 'ACTIVA') throw badRequest('Solo se pueden enviar promociones activas');
  const sent = await emailPromotion(promo);
  await recordEvent({ category: 'PROMOCION', type: 'PROMOCION_ENVIADA', actor: actorOf(admin), user: promo.user, offer: promo.offer, status: `${promo.discountPercent}% de descuento`, result: `Código ${promo.code}` });
  return view(sent);
}

export async function cancelPromotion(admin, id) {
  const promo = await prisma.promotion.findUnique({ where: { id }, include });
  if (!promo) throw notFound('Promoción no encontrada');
  if (promoStatus(promo) !== 'ACTIVA') throw badRequest('Solo se pueden cancelar promociones activas');
  const updated = await prisma.promotion.update({ where: { id }, data: { status: 'CANCELADA', cancelledAt: new Date() }, include });
  await recordEvent({ category: 'PROMOCION', type: 'PROMOCION_CANCELADA', actor: actorOf(admin), user: promo.user, offer: promo.offer, status: 'Cancelada', result: `Código ${promo.code}` });
  return view(updated);
}

export async function usablePromotion(userId, code) {
  const promo = await prisma.promotion.findUnique({ where: { code: normalizeCode(code) }, include: { offer: true, attempt: true } });
  if (!promo || promo.userId !== userId) throw notFound('Este código promocional no existe o no corresponde a tu cuenta');
  const status = promoStatus(promo);
  if (status === 'USADA') throw conflict('Este código promocional ya fue utilizado');
  if (status === 'VENCIDA') throw conflict('Este código promocional ya venció');
  if (status === 'CANCELADA') throw conflict('Este código promocional fue cancelado');
  if (promo.attempt && promo.attempt.status === 'PENDING') throw conflict('Ya tienes un pago en proceso con este código');
  return promo;
}

export async function checkPromotion(userId, code) {
  const promo = await usablePromotion(userId, code);
  return {
    code: promo.code,
    discountPercent: promo.discountPercent,
    validUntil: promo.validUntil,
    offer: { code: promo.offer.code, name: promo.offer.name, price: promo.offer.price === null ? null : num(promo.offer.price), currency: promo.offer.currency, accessDays: promo.offer.accessDays, type: promo.offer.type },
    finalPrice: promoPrice(promo.offer, promo.discountPercent),
  };
}

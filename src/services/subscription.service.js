import crypto from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { getPlan } from '../config/plans.js';
import { addMonths, effectiveStatus, hasAccess, mapPaymentStatus, mapPreapprovalStatus, unlockState } from '../domain/subscription.js';
import { conflict, HttpError, notFound } from '../utils/httpError.js';
import { mpRequest } from './mercadopago.client.js';

export function describeSubscription(sub, now = new Date()) {
  const status = effectiveStatus(sub, now);
  return {
    subscription: sub
      ? {
          id: sub.id, plan: sub.plan, amount: Number(sub.amount), currency: sub.currency, status: sub.status,
          startDate: sub.startDate, activatedAt: sub.activatedAt, nextBillingDate: sub.nextBillingDate,
          cancelledAt: sub.cancelledAt, lastPaymentAt: sub.lastPaymentAt,
        }
      : null,
    effectiveStatus: status,
    hasAccess: hasAccess(sub, now),
    academy: sub?.activatedAt ? unlockState(sub.activatedAt, now) : { currentMonth: 0, unlocked: 0, pending: 12 },
  };
}

export async function getMySubscription(userId) {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  return describeSubscription(sub);
}

// Crea la suscripción recurrente (preapproval) en Mercado Pago desde el backend.
export async function createCheckout(user) {
  const plan = getPlan();
  if (!plan.amount) throw new HttpError(503, 'El plan no tiene precio configurado (PLAN_AMOUNT)');
  const current = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (current && hasAccess(current)) throw conflict('Ya tienes una membresía activa');

  const preapproval = await mpRequest('/preapproval', {
    method: 'POST',
    idempotencyKey: crypto.randomUUID(),
    body: {
      reason: plan.name,
      external_reference: user.id,
      payer_email: user.email,
      back_url: `${env.frontendUrls[0]}/suscripcion/estado`,
      status: 'pending',
      auto_recurring: {
        frequency: plan.frequency,
        frequency_type: plan.frequencyType,
        transaction_amount: plan.amount,
        currency_id: plan.currency,
      },
    },
  });

  const data = {
    plan: plan.code,
    amount: plan.amount,
    currency: plan.currency,
    status: 'PENDING',
    mpPreapprovalId: String(preapproval.id),
    initPoint: preapproval.init_point,
    cancelledAt: null,
  };
  await prisma.subscription.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  return { initPoint: preapproval.init_point };
}

export async function cancelSubscription(userId) {
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  if (!sub) throw notFound('No tienes una suscripción');
  if (sub.mpPreapprovalId) {
    await mpRequest(`/preapproval/${sub.mpPreapprovalId}`, { method: 'PUT', body: { status: 'cancelled' } });
  }
  // Los datos financieros se conservan; solo cambia el estado de la membresía.
  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  });
  return describeSubscription(updated);
}

/* ---------------------- Webhooks (idempotentes) ---------------------- */

async function findSubscription(db, { preapprovalId, userId }) {
  if (preapprovalId) {
    const sub = await db.subscription.findUnique({ where: { mpPreapprovalId: String(preapprovalId) } });
    if (sub) return sub;
  }
  if (userId) return db.subscription.findUnique({ where: { userId: String(userId) } });
  return null;
}

/**
 * Registra un pago y, si quedó aprobado por primera vez, activa la membresía.
 * Repetir la misma notificación no produce cambios.
 */
export async function applyPayment(db, sub, { mpPaymentId, mpStatus, amount, currency, paidAt, nextBillingDate }) {
  const status = mapPaymentStatus(mpStatus);
  const existing = await db.payment.findUnique({ where: { mpPaymentId: String(mpPaymentId) } });
  if (existing && existing.status === status) return { changed: false };

  await db.payment.upsert({
    where: { mpPaymentId: String(mpPaymentId) },
    create: {
      mpPaymentId: String(mpPaymentId), userId: sub.userId, subscriptionId: sub.id,
      amount, currency, status, mpStatus, paidAt: status === 'APPROVED' ? paidAt : null,
    },
    update: { status, mpStatus, paidAt: status === 'APPROVED' ? paidAt : null },
  });

  if (status === 'APPROVED') {
    await db.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        activatedAt: sub.activatedAt || paidAt,
        startDate: sub.startDate || paidAt,
        lastPaymentAt: paidAt,
        nextBillingDate: nextBillingDate || addMonths(paidAt, 1),
        cancelledAt: null,
      },
    });
  }
  return { changed: true, status };
}

async function handlePreapproval(db, id, fetcher) {
  const pre = await fetcher(`/preapproval/${id}`);
  const sub = await findSubscription(db, { preapprovalId: pre.id, userId: pre.external_reference });
  if (!sub) return;
  const mapped = mapPreapprovalStatus(pre.status);
  const data = { mpPayerId: pre.payer_id ? String(pre.payer_id) : sub.mpPayerId, mpPreapprovalId: String(pre.id) };
  if (pre.next_payment_date) data.nextBillingDate = new Date(pre.next_payment_date);
  // "authorized" no activa por sí solo: el acceso se activa con un pago aprobado.
  if (mapped === 'CANCELLED') Object.assign(data, { status: 'CANCELLED', cancelledAt: sub.cancelledAt || new Date() });
  else if (mapped === 'PAST_DUE' && sub.status === 'ACTIVE') data.status = 'PAST_DUE';
  else if (mapped === 'ACTIVE' && sub.status === 'PAST_DUE' && sub.lastPaymentAt) data.status = 'ACTIVE';
  await db.subscription.update({ where: { id: sub.id }, data });
}

async function handleAuthorizedPayment(db, id, fetcher) {
  const ap = await fetcher(`/authorized_payments/${id}`);
  const sub = await findSubscription(db, { preapprovalId: ap.preapproval_id, userId: ap.external_reference });
  if (!sub) return;
  const paymentStatus = ap.payment?.status || (ap.status === 'processed' ? 'approved' : 'pending');
  await applyPayment(db, sub, {
    mpPaymentId: ap.payment?.id || `ap_${ap.id}`,
    mpStatus: paymentStatus,
    amount: ap.transaction_amount ?? sub.amount,
    currency: ap.currency_id || sub.currency,
    paidAt: new Date(ap.last_modified || ap.date_created || Date.now()),
  });
  if (ap.status === 'recycling' && paymentStatus === 'rejected' && sub.status === 'ACTIVE') {
    await db.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
  }
}

async function handlePayment(db, id, fetcher) {
  const pay = await fetcher(`/v1/payments/${id}`);
  const preapprovalId = pay.metadata?.preapproval_id || pay.point_of_interaction?.transaction_data?.subscription_id;
  const sub = await findSubscription(db, { preapprovalId, userId: pay.external_reference });
  if (!sub) return;
  await applyPayment(db, sub, {
    mpPaymentId: pay.id,
    mpStatus: pay.status,
    amount: pay.transaction_amount ?? sub.amount,
    currency: pay.currency_id || sub.currency,
    paidAt: new Date(pay.date_approved || pay.date_created || Date.now()),
  });
}

const HANDLERS = {
  subscription_preapproval: handlePreapproval,
  preapproval: handlePreapproval,
  subscription_authorized_payment: handleAuthorizedPayment,
  authorized_payment: handleAuthorizedPayment,
  payment: handlePayment,
};

/**
 * Procesa una notificación verificada. La información se consulta SIEMPRE a la
 * API de Mercado Pago (no se confía en el body). Idempotente por eventKey y por
 * estado de pago.
 */
export async function processNotification({ topic, dataId, eventId }, { db = prisma, fetcher = mpRequest } = {}) {
  const handler = HANDLERS[topic];
  if (!handler || !dataId) return { ignored: true };
  const eventKey = `${topic}:${dataId}:${eventId || 'na'}`;
  if (await db.webhookEvent.findUnique({ where: { eventKey } })) return { duplicate: true };

  await handler(db, dataId, fetcher);
  try {
    await db.webhookEvent.create({ data: { provider: 'mercadopago', eventKey, topic, resourceId: String(dataId) } });
  } catch (err) {
    if (err?.code !== 'P2002') throw err; // carrera entre notificaciones simultáneas
  }
  return { processed: true };
}

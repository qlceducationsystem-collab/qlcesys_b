import { prisma } from '../../config/prisma.js';
import { num } from '../../utils/money.js';
import { GATEWAY, recordEvent } from '../adminEvent.service.js';
import { applySubscriptionPayment, closeSubscription, recordReversal, refreshPaypalSubscription, resolveAttempt } from './payment.service.js';
import { mpRequest } from './mercadopago.client.js';

const bySubscriptionId = (id) => prisma.subscription.findUnique({ where: { providerSubscriptionId: String(id) }, include: { offer: true, user: true } });

const failed = (sub, result) => recordEvent({ category: 'SUSCRIPCION', type: 'PAGO_FALLIDO', actor: GATEWAY, user: sub.user, offer: sub.offer, status: 'Cobro recurrente rechazado', amount: sub.amount, result });

export async function processMpAuthorizedPayment(dataId) {
  const invoice = await mpRequest(`/authorized_payments/${encodeURIComponent(dataId)}`);
  const sub = invoice.preapproval_id ? await bySubscriptionId(invoice.preapproval_id) : null;
  if (!sub) return { ignored: true };
  const status = invoice.payment?.status;
  if (status === 'approved') {
    await applySubscriptionPayment(sub, { paymentId: String(invoice.payment.id), amount: invoice.transaction_amount, currency: invoice.currency_id });
  } else if (status === 'rejected') {
    await failed(sub, invoice.payment?.status_detail || null);
  }
  return { processed: true };
}

export async function processMpPreapproval(dataId) {
  const preapproval = await mpRequest(`/preapproval/${encodeURIComponent(dataId)}`);
  const sub = await bySubscriptionId(preapproval.id || dataId);
  if (!sub) return { ignored: true };
  if (['canceled', 'cancelled'].includes(preapproval.status)) await closeSubscription(sub, 'CANCELLED');
  else if (preapproval.status === 'paused') await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'SUSPENDED' } });
  else if (preapproval.status === 'authorized') await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', nextBillingAt: preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : sub.nextBillingAt } });
  return { processed: true };
}

const parentCaptureId = (resource) => {
  const up = (resource.links || []).find((l) => l.rel === 'up')?.href;
  return up ? up.split('/').pop() : null;
};

const HANDLERS = {
  'BILLING.SUBSCRIPTION.ACTIVATED': async (r) => {
    const sub = await bySubscriptionId(r.id);
    if (sub) await refreshPaypalSubscription(sub);
  },
  'BILLING.SUBSCRIPTION.CANCELLED': async (r) => {
    const sub = await bySubscriptionId(r.id);
    if (sub) await closeSubscription(sub, 'CANCELLED');
  },
  'BILLING.SUBSCRIPTION.EXPIRED': async (r) => {
    const sub = await bySubscriptionId(r.id);
    if (sub) await closeSubscription(sub, 'EXPIRED');
  },
  'BILLING.SUBSCRIPTION.SUSPENDED': async (r) => {
    const sub = await bySubscriptionId(r.id);
    if (sub) await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'SUSPENDED' } });
  },
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED': async (r) => {
    const sub = await bySubscriptionId(r.id);
    if (sub) await failed(sub, 'PayPal no pudo realizar el cobro');
  },
  'PAYMENT.SALE.COMPLETED': async (r) => {
    const sub = r.billing_agreement_id ? await bySubscriptionId(r.billing_agreement_id) : null;
    if (sub) await applySubscriptionPayment(sub, { paymentId: String(r.id), amount: num(r.amount?.total), currency: r.amount?.currency });
  },
  'PAYMENT.SALE.REFUNDED': (r) => recordReversal(String(r.sale_id || r.id), 'Reembolso'),
  'PAYMENT.SALE.REVERSED': (r) => recordReversal(String(r.sale_id || r.id), 'Contracargo'),
  'PAYMENT.CAPTURE.COMPLETED': async (r) => {
    if (r.custom_id) await resolveAttempt(r.custom_id, 'APPROVED', prisma, { paidAmount: num(r.amount?.value), paidCurrency: r.amount?.currency_code, paymentId: String(r.id) });
  },
  'PAYMENT.CAPTURE.DECLINED': async (r) => {
    if (r.custom_id) await resolveAttempt(r.custom_id, 'REJECTED');
  },
  'PAYMENT.CAPTURE.REFUNDED': (r) => recordReversal(parentCaptureId(r) || String(r.id), 'Reembolso'),
  'PAYMENT.CAPTURE.REVERSED': (r) => recordReversal(parentCaptureId(r) || String(r.id), 'Contracargo'),
};

export async function processPaypalEvent(event) {
  const eventKey = `paypal:${event.id}`;
  if (await prisma.webhookEvent.findUnique({ where: { eventKey } })) return { duplicate: true };
  const handler = HANDLERS[event.event_type];
  if (handler) await handler(event.resource || {});
  try {
    await prisma.webhookEvent.create({ data: { provider: 'paypal', eventKey, topic: event.event_type, resourceId: String(event.resource?.id || '') } });
  } catch (err) {
    if (err?.code !== 'P2002') throw err;
  }
  return { processed: !!handler };
}

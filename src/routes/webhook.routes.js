import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { verifyWebhookSignature } from '../services/payments/mercadopago.client.js';
import { mercadoPagoProvider } from '../services/payments/providers.js';
import { resolveAttempt } from '../services/payments/payment.service.js';
import { mercadoPagoWebhookSecret } from '../services/payments/paymentSettings.service.js';
import { GATEWAY, recordEvent } from '../services/adminEvent.service.js';
import { verifyPaypalWebhook } from '../services/payments/paypalSettings.service.js';
import { processMpAuthorizedPayment, processMpPreapproval, processPaypalEvent } from '../services/payments/subscriptionEvents.service.js';

const r = Router();

export async function processMercadoPagoPayment({ dataId, eventId }, { db = prisma, fetcher } = {}) {
  const eventKey = `payment:${dataId}:${eventId || 'na'}`;
  if (await db.webhookEvent.findUnique({ where: { eventKey } })) return { duplicate: true };
  const { attemptId, status, amount, currency, paymentId, reversed, rawStatus, statusDetail } = await mercadoPagoProvider.fetchPaymentResult(dataId, fetcher);
  let attempt = attemptId ? await db.paymentAttempt.findUnique({ where: { id: String(attemptId) }, include: { user: true, offer: true } }) : null;
  if (attempt?.subscriptionId) {
    attempt = reversed ? await db.paymentAttempt.findFirst({ where: { providerPaymentId: String(paymentId) }, include: { user: true, offer: true } }) : null;
  }
  if (attempt?.provider === 'MERCADOPAGO') {
    if (reversed && attempt.status === 'APPROVED') {
      await recordEvent({ category: 'SUSCRIPCION', type: 'PAGO_REVERTIDO', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: rawStatus === 'refunded' ? 'Reembolsado' : 'Contracargo', amount, result: 'El acceso sigue activo: revísalo en Control de accesos' });
    } else if (status !== 'PENDING') {
      await resolveAttempt(attempt.id, status, db, { paidAmount: amount, paidCurrency: currency, paymentId, failureDetail: status === 'REJECTED' && statusDetail ? `Mercado Pago: ${statusDetail}` : undefined });
    }
  }
  try {
    await db.webhookEvent.create({ data: { provider: 'mercadopago', eventKey, topic: 'payment', resourceId: String(dataId) } });
  } catch (err) {
    if (err?.code !== 'P2002') throw err;
  }
  return { processed: true };
}

r.post('/mercadopago', async (req, res) => {
  const topic = req.body?.type || req.query.type || req.query.topic;
  const dataId = req.query['data.id'] || req.body?.data?.id || req.query.id;
  const requestId = req.headers['x-request-id'];
  const secret = await mercadoPagoWebhookSecret().catch(() => null);
  if (!secret) return res.status(200).json({ ignored: true });
  const valid = verifyWebhookSignature({ signature: req.headers['x-signature'], requestId, dataId, secret });
  if (!valid) return res.status(401).json({ error: 'Firma inválida' });
  if (!dataId) return res.status(200).json({ ignored: true });
  if (topic === 'subscription_authorized_payment' || topic === 'subscription_preapproval') {
    try {
      return res.status(200).json(await (topic === 'subscription_preapproval' ? processMpPreapproval(String(dataId)) : processMpAuthorizedPayment(String(dataId))));
    } catch (err) {
      console.error('[webhook] error procesando suscripción:', err.message);
      return res.status(500).json({ error: 'Error procesando notificación' });
    }
  }
  if (topic !== 'payment') return res.status(200).json({ ignored: true });
  try {
    res.status(200).json(await processMercadoPagoPayment({ dataId: String(dataId), eventId: requestId }));
  } catch (err) {
    console.error('[webhook] error procesando notificación:', err.message);
    res.status(500).json({ error: 'Error procesando notificación' });
  }
});

r.post('/paypal', async (req, res) => {
  const event = req.body;
  if (!event?.id || !event?.event_type) return res.status(400).json({ error: 'Notificación inválida' });
  let valid = false;
  try {
    valid = await verifyPaypalWebhook(req.headers, event);
  } catch (err) {
    console.error('[webhook] no se pudo verificar PayPal:', err.message);
    return res.status(500).json({ error: 'No se pudo verificar la notificación' });
  }
  if (!valid) return res.status(401).json({ error: 'Firma inválida' });
  try {
    res.status(200).json(await processPaypalEvent(event));
  } catch (err) {
    console.error('[webhook] error procesando PayPal:', err.message);
    res.status(500).json({ error: 'Error procesando notificación' });
  }
});

export default r;

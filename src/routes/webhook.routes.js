import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { verifyWebhookSignature } from '../services/payments/mercadopago.client.js';
import { mercadoPagoProvider } from '../services/payments/providers.js';
import { resolveAttempt } from '../services/payments/payment.service.js';
import { mercadoPagoWebhookSecret } from '../services/payments/paymentSettings.service.js';
import { GATEWAY, recordEvent } from '../services/adminEvent.service.js';

const r = Router();

export async function processMercadoPagoPayment({ dataId, eventId }, { db = prisma, fetcher } = {}) {
  const eventKey = `payment:${dataId}:${eventId || 'na'}`;
  if (await db.webhookEvent.findUnique({ where: { eventKey } })) return { duplicate: true };
  const { attemptId, status, amount, currency, paymentId, reversed, rawStatus } = await mercadoPagoProvider.fetchPaymentResult(dataId, fetcher);
  const attempt = attemptId ? await db.paymentAttempt.findUnique({ where: { id: String(attemptId) }, include: { user: true, offer: true } }) : null;
  if (attempt?.provider === 'MERCADOPAGO') {
    if (reversed && attempt.status === 'APPROVED') {
      await recordEvent({ category: 'SUSCRIPCION', type: 'PAGO_REVERTIDO', actor: GATEWAY, user: attempt.user, offer: attempt.offer, status: rawStatus === 'refunded' ? 'Reembolsado' : 'Contracargo', amount, result: 'El acceso sigue activo: revísalo en Control de accesos' });
    } else if (status !== 'PENDING') {
      await resolveAttempt(attempt.id, status, db, { paidAmount: amount, paidCurrency: currency, paymentId });
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
  if (topic !== 'payment' || !dataId) return res.status(200).json({ ignored: true });
  try {
    res.status(200).json(await processMercadoPagoPayment({ dataId: String(dataId), eventId: requestId }));
  } catch (err) {
    console.error('[webhook] error procesando notificación:', err.message);
    res.status(500).json({ error: 'Error procesando notificación' });
  }
});

export default r;

import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { verifyWebhookSignature } from '../services/payments/mercadopago.client.js';
import { mercadoPagoProvider } from '../services/payments/providers.js';
import { resolveAttempt } from '../services/payments/payment.service.js';

const r = Router();

export async function processMercadoPagoPayment({ dataId, eventId }, { db = prisma, fetcher } = {}) {
  const eventKey = `payment:${dataId}:${eventId || 'na'}`;
  if (await db.webhookEvent.findUnique({ where: { eventKey } })) return { duplicate: true };
  const { attemptId, status } = await mercadoPagoProvider.fetchPaymentResult(dataId, fetcher);
  if (attemptId && status !== 'PENDING') await resolveAttempt(attemptId, status, db);
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
  if (env.paymentProvider !== 'mercadopago') return res.status(200).json({ ignored: true });
  const valid = verifyWebhookSignature({ signature: req.headers['x-signature'], requestId, dataId });
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

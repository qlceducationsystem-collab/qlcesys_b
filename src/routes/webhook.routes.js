import { Router } from 'express';
import { env } from '../config/env.js';
import { verifyWebhookSignature } from '../services/mercadopago.client.js';
import { processNotification } from '../services/subscription.service.js';

const r = Router();

r.post('/mercadopago', async (req, res) => {
  const topic = req.body?.type || req.query.type || req.query.topic;
  const dataId = req.query['data.id'] || req.body?.data?.id || req.query.id;
  const requestId = req.headers['x-request-id'];

  const valid = verifyWebhookSignature({ signature: req.headers['x-signature'], requestId, dataId });
  if (!valid && (env.isProd || env.mercadoPago.webhookSecret)) {
    return res.status(401).json({ error: 'Firma inválida' });
  }
  try {
    const result = await processNotification({ topic, dataId: dataId && String(dataId), eventId: requestId || req.body?.id });
    res.status(200).json(result);
  } catch (err) {
    console.error('[webhook] error procesando notificación:', err.message);
    // 500 → Mercado Pago reintentará la notificación.
    res.status(500).json({ error: 'Error procesando notificación' });
  }
});

export default r;

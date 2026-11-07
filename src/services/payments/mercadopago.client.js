import crypto from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { mercadoPagoToken } from './paymentSettings.service.js';

const API = 'https://api.mercadopago.com';

export async function mpRequest(path, { method = 'GET', body, idempotencyKey, deviceId } = {}) {
  const token = await mercadoPagoToken();
  if (!token) throw new HttpError(503, 'Mercado Pago no está configurado');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
      ...(deviceId ? { 'X-meli-session-id': deviceId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[mercadopago] ${method} ${path} → ${res.status}: ${data?.message || 'error'}`);
    const error = new HttpError(502, 'No pudimos comunicarnos con el procesador de pagos');
    error.providerStatus = res.status;
    throw error;
  }
  return data;
}

export function verifyWebhookSignature({ signature, requestId, dataId, secret }) {
  if (!secret || !signature) return false;
  const parts = Object.fromEntries(
    String(signature)
      .split(',')
      .map((p) => p.split('=').map((s) => s.trim())),
  );
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId || '') ? String(dataId).toLowerCase() : dataId;
  let manifest = '';
  if (id) manifest += `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(parts.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

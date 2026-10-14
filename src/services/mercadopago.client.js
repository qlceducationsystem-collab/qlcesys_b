import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

const API = 'https://api.mercadopago.com';

export const mpConfigured = () => !!env.mercadoPago.accessToken;

// Cliente mínimo de la API REST de Mercado Pago (solo backend).
export async function mpRequest(path, { method = 'GET', body, idempotencyKey } = {}) {
  if (!mpConfigured()) throw new HttpError(503, 'Mercado Pago no está configurado');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.mercadoPago.accessToken}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[mercadopago] ${method} ${path} → ${res.status}: ${data?.message || 'error'}`);
    throw new HttpError(502, 'Error al comunicarse con Mercado Pago');
  }
  return data;
}

/**
 * Verifica la firma x-signature de una notificación.
 * Manifest: id:{data.id};request-id:{x-request-id};ts:{ts};
 */
export function verifyWebhookSignature({ signature, requestId, dataId, secret = env.mercadoPago.webhookSecret }) {
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

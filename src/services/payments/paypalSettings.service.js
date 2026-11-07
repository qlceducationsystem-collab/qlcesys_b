import { prisma } from '../../config/prisma.js';
import { decryptSecret } from '../../utils/crypto.js';
import { HttpError } from '../../utils/httpError.js';

const KEY = 'paypal';
const API = { SANDBOX: 'https://api-m.sandbox.paypal.com', LIVE: 'https://api-m.paypal.com' };
const DEFAULTS = { mode: 'SANDBOX', clientId: null, encryptedSecret: null, webhookId: null };
let cache = null;
let token = null;

export async function paypalSettings() {
  if (cache) return cache;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  cache = { ...DEFAULTS, ...(row?.value || {}) };
  return cache;
}

export const resetPaypalCache = () => {
  cache = null;
  token = null;
};

const secretOf = (settings) => {
  if (!settings.encryptedSecret) return null;
  try {
    return decryptSecret(settings.encryptedSecret);
  } catch {
    return null;
  }
};

async function accessToken(settings) {
  if (token && token.expiresAt > Date.now()) return token.value;
  const secret = secretOf(settings);
  if (!settings.clientId || !secret) throw new HttpError(503, 'PayPal no está configurado');
  const res = await fetch(`${API[settings.mode]}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${settings.clientId}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const error = new HttpError(502, res.status === 401 ? 'PayPal rechazó el Client ID o el Secret' : 'No pudimos comunicarnos con PayPal');
    error.providerStatus = res.status;
    throw error;
  }
  token = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 300) * 900 };
  return token.value;
}

export async function paypalRequest(path, { method = 'GET', body, requestId } = {}) {
  const settings = await paypalSettings();
  const bearer = await accessToken(settings);
  const res = await fetch(`${API[settings.mode]}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[paypal] ${method} ${path} → ${res.status}: ${data?.name || ''} ${data?.message || ''}`);
    const error = new HttpError(502, 'No pudimos comunicarnos con PayPal');
    error.providerStatus = res.status;
    error.providerIssue = data?.details?.[0]?.issue || data?.name || null;
    throw error;
  }
  return data;
}

export async function verifyPaypalWebhook(headers, event) {
  const settings = await paypalSettings();
  if (!settings.webhookId) return false;
  const data = await paypalRequest('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: settings.webhookId,
      webhook_event: event,
    },
  });
  return data.verification_status === 'SUCCESS';
}

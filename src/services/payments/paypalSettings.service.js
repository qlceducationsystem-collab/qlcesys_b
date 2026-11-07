import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../utils/crypto.js';
import { badRequest, conflict } from '../../utils/httpError.js';
import { HttpError } from '../../utils/httpError.js';
import { convertTo } from './paymentSettings.service.js';

const KEY = 'paypal';
const API = { SANDBOX: 'https://api-m.sandbox.paypal.com', LIVE: 'https://api-m.paypal.com' };
export const PAYPAL_CURRENCIES = ['USD', 'MXN'];
const DEFAULTS = { enabled: false, mode: 'SANDBOX', clientId: null, encryptedSecret: null, webhookId: null, currency: 'USD', rates: {}, productId: null, plans: {}, lastTest: null };
let cache = null;
let token = null;

export async function paypalSettings() {
  if (cache) return cache;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  cache = { ...DEFAULTS, ...(row?.value || {}) };
  return cache;
}

export async function writePaypalSettings(changes) {
  const value = { ...(await paypalSettings()), ...changes };
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  cache = null;
  token = null;
  return paypalSettings();
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

const offerCurrencies = async () => {
  const rows = await prisma.productOffer.findMany({ where: { active: true }, select: { currency: true }, distinct: ['currency'] });
  return rows.map((r) => String(r.currency).toUpperCase());
};

const missingRequirements = (settings, currencies) => {
  const missing = [];
  if (!settings.clientId) missing.push('el Client ID');
  if (!settings.encryptedSecret) missing.push('el Secret');
  if (!settings.webhookId) missing.push('el Webhook ID');
  if (!settings.lastTest?.ok) missing.push('una prueba de conexión correcta');
  for (const c of currencies) if (c !== settings.currency && !(Number(settings.rates?.[c]) > 0)) missing.push(`el tipo de cambio de ${c}`);
  return missing;
};

export async function paypalSettingsView() {
  const settings = await paypalSettings();
  const currencies = await offerCurrencies();
  return {
    enabled: !!settings.enabled,
    mode: settings.mode,
    clientId: settings.clientId || '',
    hasSecret: !!settings.encryptedSecret,
    webhookId: settings.webhookId || '',
    currency: settings.currency,
    currencies: PAYPAL_CURRENCIES,
    rates: settings.rates || {},
    ratesNeeded: currencies.filter((c) => c !== settings.currency),
    lastTest: settings.lastTest,
    encryptionReady: !!env.tokenEncryptionKey,
    webhookUrl: `${env.backendUrl}/api/webhooks/paypal`,
    missing: missingRequirements(settings, currencies),
  };
}

export async function savePaypalSettings({ clientId, clientSecret, webhookId, mode, currency, rates, enabled }) {
  const current = await paypalSettings();
  const changes = {};
  if (clientSecret && !env.tokenEncryptionKey) throw badRequest('Falta TOKEN_ENCRYPTION_KEY en el servidor para guardar las credenciales cifradas');
  const account = (clientId && clientId !== current.clientId) || clientSecret || (mode && mode !== current.mode);
  if (clientId) changes.clientId = clientId;
  if (clientSecret) changes.encryptedSecret = encryptSecret(clientSecret);
  if (mode) changes.mode = mode;
  if (account) Object.assign(changes, { enabled: false, lastTest: null, productId: null, plans: {} });
  if (webhookId) changes.webhookId = webhookId;
  if (currency) changes.currency = currency;
  if (rates) changes.rates = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k.toUpperCase(), Number(v)]).filter(([, v]) => v > 0));
  const next = await writePaypalSettings(changes);
  if (enabled === true) {
    const missing = missingRequirements(next, await offerCurrencies());
    if (missing.length) throw badRequest(`Para activar PayPal falta: ${missing.join(', ')}.`);
  }
  if (enabled !== undefined) await writePaypalSettings({ enabled: !!enabled && !account });
  return paypalSettingsView();
}

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

export async function testPaypalConnection() {
  const settings = await paypalSettings();
  if (!settings.clientId || !settings.encryptedSecret) throw badRequest('Guarda primero el Client ID y el Secret');
  const at = new Date().toISOString();
  token = null;
  try {
    await accessToken(settings);
    await writePaypalSettings({ lastTest: { at, ok: true, error: null } });
  } catch (err) {
    await writePaypalSettings({ lastTest: { at, ok: false, error: err.message.slice(0, 200) }, enabled: false });
  }
  return paypalSettingsView();
}

export async function paypalQuote(amount, currency) {
  const settings = await paypalSettings();
  if (!settings.enabled) throw conflict('PayPal no está disponible');
  return convertTo(amount, currency, settings.currency, settings.rates);
}

export async function publicPaypalInfo() {
  const settings = await paypalSettings();
  if (!settings.enabled) return null;
  return { currency: settings.currency, rates: settings.rates || {}, whole: false };
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

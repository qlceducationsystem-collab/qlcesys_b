import crypto from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../utils/crypto.js';
import { badRequest, conflict, HttpError } from '../../utils/httpError.js';
import { round2 } from '../../utils/money.js';

const KEY = 'dlocalgo';
const API = { SANDBOX: 'https://api-sbx.dlocalgo.com', LIVE: 'https://api.dlocalgo.com' };
export const DLOCAL_CURRENCIES = ['USD', 'MXN'];
export const DLOCAL_METHODS = ['NO_CARDS', 'ALL'];
export const DLOCAL_COUNTRIES = ['AR', 'BO', 'BR', 'CL', 'CO', 'CR', 'DO', 'EC', 'GT', 'MX', 'PA', 'PE', 'PY', 'UY', 'ID', 'KE', 'MY', 'NG'];
const DEFAULTS = { enabled: false, mode: 'SANDBOX', encryptedApiKey: null, encryptedSecret: null, currency: 'USD', methods: 'NO_CARDS', rates: {}, lastTest: null };
let cache = null;

export async function dlocalSettings() {
  if (cache) return cache;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  cache = { ...DEFAULTS, ...(row?.value || {}) };
  return cache;
}

async function write(changes) {
  const value = { ...(await dlocalSettings()), ...changes };
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  cache = null;
  return dlocalSettings();
}

export const resetDlocalCache = () => {
  cache = null;
};

const open = (payload) => {
  if (!payload) return null;
  try {
    return decryptSecret(payload);
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
  if (!settings.encryptedApiKey) missing.push('la API Key');
  if (!settings.encryptedSecret) missing.push('la Secret Key');
  if (!settings.lastTest?.ok) missing.push('una prueba de conexión correcta');
  for (const c of currencies) if (c !== settings.currency && !(Number(settings.rates?.[c]) > 0)) missing.push(`el tipo de cambio de ${c}`);
  return missing;
};

export async function dlocalSettingsView() {
  const settings = await dlocalSettings();
  const currencies = await offerCurrencies();
  return {
    enabled: !!settings.enabled,
    mode: settings.mode,
    hasApiKey: !!settings.encryptedApiKey,
    hasSecret: !!settings.encryptedSecret,
    currency: settings.currency,
    currencies: DLOCAL_CURRENCIES,
    methods: settings.methods,
    rates: settings.rates || {},
    ratesNeeded: currencies.filter((c) => c !== settings.currency),
    lastTest: settings.lastTest,
    encryptionReady: !!env.tokenEncryptionKey,
    missing: missingRequirements(settings, currencies),
  };
}

export async function saveDlocalSettings({ apiKey, secretKey, mode, currency, methods, rates, enabled }) {
  const current = await dlocalSettings();
  if ((apiKey || secretKey) && !env.tokenEncryptionKey) throw badRequest('Falta TOKEN_ENCRYPTION_KEY en el servidor para guardar las credenciales cifradas');
  const account = apiKey || secretKey || (mode && mode !== current.mode);
  const changes = {};
  if (apiKey) changes.encryptedApiKey = encryptSecret(apiKey);
  if (secretKey) changes.encryptedSecret = encryptSecret(secretKey);
  if (mode) changes.mode = mode;
  if (account) Object.assign(changes, { enabled: false, lastTest: null });
  if (currency) changes.currency = currency;
  if (methods) changes.methods = methods;
  if (rates) changes.rates = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k.toUpperCase(), Number(v)]).filter(([, v]) => v > 0));
  const next = await write(changes);
  if (enabled === true) {
    const missing = missingRequirements(next, await offerCurrencies());
    if (missing.length) throw badRequest(`Para activar dLocal Go falta: ${missing.join(', ')}.`);
  }
  if (enabled !== undefined) await write({ enabled: !!enabled && !account });
  return dlocalSettingsView();
}

export async function dlocalRequest(path, { method = 'GET', body } = {}) {
  const settings = await dlocalSettings();
  const apiKey = open(settings.encryptedApiKey);
  const secret = open(settings.encryptedSecret);
  if (!apiKey || !secret) throw new HttpError(503, 'dLocal Go no está configurado');
  const res = await fetch(`${API[settings.mode]}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}:${secret}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[dlocalgo] ${method} ${path} → ${res.status}: ${data?.code || ''} ${data?.message || ''}`);
    const unavailable = data?.code === 5010 || data?.code === 5003;
    const error = new HttpError(unavailable ? 409 : 502, unavailable ? 'Este método de pago no está disponible en tu país. Elige otra forma de pago.' : 'No pudimos comunicarnos con el procesador de pagos');
    error.providerStatus = res.status;
    throw error;
  }
  return data;
}

export async function testDlocalConnection() {
  const settings = await dlocalSettings();
  if (!settings.encryptedApiKey || !settings.encryptedSecret) throw badRequest('Guarda primero la API Key y la Secret Key');
  const at = new Date().toISOString();
  try {
    await dlocalRequest('/v1/currency-exchanges');
    await write({ lastTest: { at, ok: true, error: null } });
  } catch (err) {
    await write({ lastTest: { at, ok: false, error: err.providerStatus === 403 || err.providerStatus === 401 ? 'dLocal Go rechazó las llaves' : err.message.slice(0, 200) }, enabled: false });
  }
  return dlocalSettingsView();
}

function convertTo(amount, currency, target, rates) {
  if (amount === null || amount === undefined) throw conflict('Este acceso todavía no tiene precio definido');
  const source = String(currency).toUpperCase();
  if (source === target) return { amount: round2(Number(amount)), currency: target };
  const rate = Number(rates?.[source]);
  if (!(rate > 0)) throw conflict(`Falta el tipo de cambio de ${source} a ${target}. Configúralo en Pasarela de pago.`);
  return { amount: round2(Number(amount) * rate), currency: target };
}

export async function dlocalQuote(amount, currency) {
  const settings = await dlocalSettings();
  if (!settings.enabled) throw conflict('Esta forma de pago no está disponible');
  return convertTo(amount, currency, settings.currency, settings.rates);
}

export async function publicDlocalInfo() {
  const settings = await dlocalSettings();
  if (!settings.enabled) return null;
  return { currency: settings.currency, rates: settings.rates || {}, whole: false, countries: DLOCAL_COUNTRIES };
}

export async function verifyDlocalSignature(header, rawBody) {
  const settings = await dlocalSettings();
  const apiKey = open(settings.encryptedApiKey);
  const secret = open(settings.encryptedSecret);
  const received = /Signature:\s*([0-9a-f]+)/i.exec(String(header || ''))?.[1];
  if (!apiKey || !secret || !received || rawBody === undefined) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${apiKey}${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(received.toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

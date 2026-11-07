import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../utils/crypto.js';
import { badRequest, conflict } from '../../utils/httpError.js';
import { round2 } from '../../utils/money.js';

const KEY = 'mercadopago';
const SITE_CURRENCY = { MLM: 'MXN', MLA: 'ARS', MLB: 'BRL', MLC: 'CLP', MCO: 'COP', MPE: 'PEN', MLU: 'UYU' };
const WHOLE_CURRENCIES = ['CLP', 'COP'];
const DEFAULTS = { enabled: false, publicKey: null, encryptedToken: null, encryptedWebhookSecret: null, rates: {}, account: null, lastTest: null };
let cache = null;

export async function paymentSettings() {
  if (cache) return cache;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  cache = { ...DEFAULTS, ...(row?.value || {}) };
  return cache;
}

async function write(changes) {
  const value = { ...(await paymentSettings()), ...changes };
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  cache = null;
  return paymentSettings();
}

export const resetPaymentSettingsCache = () => {
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

export const mercadoPagoToken = async () => open((await paymentSettings()).encryptedToken);
export const mercadoPagoWebhookSecret = async () => open((await paymentSettings()).encryptedWebhookSecret);
export const isTestToken = (token) => String(token || '').startsWith('TEST-');

export const chargeCurrency = (settings) => SITE_CURRENCY[settings.account?.siteId] || null;

const offerCurrencies = async () => {
  const rows = await prisma.productOffer.findMany({ where: { active: true }, select: { currency: true }, distinct: ['currency'] });
  return rows.map((r) => String(r.currency).toUpperCase());
};

export function convertForCharge(amount, currency, settings) {
  const target = chargeCurrency(settings);
  if (!target) throw conflict('Mercado Pago no está configurado');
  const source = String(currency).toUpperCase();
  if (source === target) return { amount: round2(Number(amount)), currency: target };
  const rate = Number(settings.rates?.[source]);
  if (!(rate > 0)) throw conflict(`Falta el tipo de cambio de ${source} a ${target}. Configúralo en Pasarela de pago.`);
  const converted = Number(amount) * rate;
  return { amount: WHOLE_CURRENCIES.includes(target) ? Math.ceil(converted) : round2(converted), currency: target };
}

const sameKind = (publicKey, token) => isTestToken(publicKey) === isTestToken(token);

const missingRequirements = (settings, currencies, token) => {
  const missing = [];
  if (!settings.encryptedToken) missing.push('el Access Token');
  if (!settings.publicKey) missing.push('la Public Key');
  else if (token && !sameKind(settings.publicKey, token)) missing.push('una Public Key del mismo tipo que el Access Token (prueba o producción)');
  if (!settings.encryptedWebhookSecret) missing.push('la clave secreta del webhook');
  if (!settings.lastTest?.ok) missing.push('una prueba de conexión correcta');
  const target = chargeCurrency(settings);
  for (const c of currencies) if (target && c !== target && !(Number(settings.rates?.[c]) > 0)) missing.push(`el tipo de cambio de ${c}`);
  return missing;
};

export async function paymentSettingsView() {
  const settings = await paymentSettings();
  const currencies = await offerCurrencies();
  const token = await mercadoPagoToken();
  const target = chargeCurrency(settings);
  return {
    enabled: !!settings.enabled,
    hasToken: !!settings.encryptedToken,
    publicKey: settings.publicKey || '',
    hasWebhookSecret: !!settings.encryptedWebhookSecret,
    testMode: isTestToken(token) || !!settings.account?.testUser,
    encryptionReady: !!env.tokenEncryptionKey,
    account: settings.account ? { nickname: settings.account.nickname, siteId: settings.account.siteId } : null,
    chargeCurrency: target,
    rates: settings.rates || {},
    ratesNeeded: target ? currencies.filter((c) => c !== target) : [],
    lastTest: settings.lastTest,
    webhookUrl: `${env.backendUrl}/api/webhooks/mercadopago`,
    missing: missingRequirements(settings, currencies, token),
  };
}

export async function savePaymentSettings({ accessToken, publicKey, webhookSecret, rates, enabled }) {
  const changes = {};
  if (accessToken || webhookSecret) {
    if (!env.tokenEncryptionKey) throw badRequest('Falta TOKEN_ENCRYPTION_KEY en el servidor para guardar las credenciales cifradas');
  }
  if (accessToken) {
    Object.assign(changes, { encryptedToken: encryptSecret(accessToken), lastTest: null, account: null, enabled: false });
  }
  if (publicKey) changes.publicKey = publicKey;
  if (webhookSecret) changes.encryptedWebhookSecret = encryptSecret(webhookSecret);
  if (rates) changes.rates = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k.toUpperCase(), Number(v)]).filter(([, v]) => v > 0));
  const next = await write(changes);
  if (enabled === true) {
    const missing = missingRequirements(next, await offerCurrencies(), await mercadoPagoToken());
    if (missing.length) throw badRequest(`Para activar Mercado Pago falta: ${missing.join(', ')}.`);
  }
  if (enabled !== undefined) await write({ enabled: !!enabled && !changes.encryptedToken });
  return paymentSettingsView();
}

export async function testMercadoPagoConnection(fetcher = fetch) {
  const token = await mercadoPagoToken();
  if (!token) throw badRequest('Guarda primero el Access Token');
  const at = new Date().toISOString();
  try {
    const res = await fetcher('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 401 ? 'Mercado Pago rechazó el Access Token' : `Mercado Pago respondió ${res.status}`);
    if (!SITE_CURRENCY[data.site_id]) throw new Error(`El país de esta cuenta (${data.site_id || 'desconocido'}) no está soportado`);
    await write({
      account: { id: data.id, nickname: data.nickname || null, siteId: data.site_id, testUser: (data.tags || []).includes('test_user') },
      lastTest: { at, ok: true, error: null },
    });
  } catch (err) {
    await write({ lastTest: { at, ok: false, error: err.message.slice(0, 200) }, enabled: false });
  }
  return paymentSettingsView();
}

export async function publicChargeInfo() {
  const settings = await paymentSettings();
  if (!settings.enabled) return null;
  return { currency: chargeCurrency(settings), rates: settings.rates || {}, whole: WHOLE_CURRENCIES.includes(chargeCurrency(settings)) };
}

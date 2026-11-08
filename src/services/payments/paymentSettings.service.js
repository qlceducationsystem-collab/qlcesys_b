import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../utils/crypto.js';
import { badRequest, conflict } from '../../utils/httpError.js';
import { round2 } from '../../utils/money.js';

const KEY = 'mercadopago';
const SITE_CURRENCY = { MLM: 'MXN', MLA: 'ARS', MLB: 'BRL', MLC: 'CLP', MCO: 'COP', MPE: 'PEN', MLU: 'UYU' };
const WHOLE_CURRENCIES = ['CLP', 'COP'];
const DEFAULTS = { enabled: false, encryptedToken: null, encryptedWebhookSecret: null, rates: {}, marketRates: {}, ratesUpdatedAt: null, ratesError: null, testPayerEmail: null, account: null, lastTest: null };
export const RATE_MARKUP = 1;
const MAX_RATE_JUMP = 0.25;
const RATES_STALE_MS = 72 * 3600000;
const RATE_TIMEOUT_MS = 10000;
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

export async function mpTesting() {
  const settings = await paymentSettings();
  return !!settings.account?.testUser || isTestToken(await mercadoPagoToken());
}

export async function payerEmailFor(user) {
  const settings = await paymentSettings();
  return (await mpTesting()) && settings.testPayerEmail ? settings.testPayerEmail : user.email;
}

export const chargeCurrency = (settings) => SITE_CURRENCY[settings.account?.siteId] || null;

const offerCurrencies = async () => {
  const rows = await prisma.productOffer.findMany({ where: { active: true }, select: { currency: true }, distinct: ['currency'] });
  return rows.map((r) => String(r.currency).toUpperCase());
};

export function convertForCharge(amount, currency, settings) {
  const target = chargeCurrency(settings);
  if (!target) throw conflict('Mercado Pago no está configurado');
  return convertTo(amount, currency, target, settings.rates);
}

export function convertTo(amount, currency, target, rates) {
  if (amount === null || amount === undefined) throw conflict('Este acceso todavía no tiene precio definido');
  const source = String(currency).toUpperCase();
  if (source === target) return { amount: round2(Number(amount)), currency: target };
  const rate = Number(rates?.[source]);
  if (!(rate > 0)) throw conflict(`Falta el tipo de cambio de ${source} a ${target}. Configúralo en Pasarela de pago.`);
  const converted = Number(amount) * rate;
  return { amount: WHOLE_CURRENCIES.includes(target) ? Math.ceil(converted) : round2(converted), currency: target };
}

async function getJson(url, fetcher) {
  const res = await fetcher(url, { signal: AbortSignal.timeout(RATE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`respondió ${res.status}`);
  return res.json();
}

const validRate = (value) => {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('valor no válido');
  return rate;
};

async function officialRate(code, target, fetcher) {
  try {
    const data = await getJson(`https://api.frankfurter.dev/v1/latest?base=${code}&symbols=${target}`, fetcher);
    return validRate(data.rates?.[target]);
  } catch {
    const data = await getJson(`https://open.er-api.com/v6/latest/${code}`, fetcher);
    return validRate(data.rates?.[target]);
  }
}

async function marketRate(code, target, fetcher) {
  if (code === 'USDT' && target === 'MXN') {
    try {
      const data = await getJson('https://api.bitso.com/v3/ticker/?book=usdt_mxn', fetcher);
      return validRate(data.payload?.ask);
    } catch {
      return officialRate('USD', target, fetcher);
    }
  }
  return officialRate(code === 'USDT' ? 'USD' : code, target, fetcher);
}

export async function refreshExchangeRates(fetcher = fetch, now = new Date()) {
  const settings = await paymentSettings();
  const target = chargeCurrency(settings);
  if (!target) return { updated: false };
  const rates = { ...settings.rates };
  const marketRates = { ...settings.marketRates };
  const problems = [];
  for (const code of (await offerCurrencies()).filter((c) => c !== target)) {
    try {
      const market = await marketRate(code, target, fetcher);
      const previous = Number(settings.marketRates?.[code]);
      if (previous > 0 && Math.abs(market - previous) / previous > MAX_RATE_JUMP) throw new Error(`cambio mayor a ${MAX_RATE_JUMP * 100}%: ${market}`);
      marketRates[code] = market;
      rates[code] = Number((market + RATE_MARKUP).toFixed(4));
    } catch (err) {
      problems.push(`${code}: ${err.message}`.slice(0, 120));
    }
  }
  const ratesError = problems.length ? problems.join('; ') : null;
  if (ratesError) console.error('[qlc] tipo de cambio sin actualizar:', ratesError);
  await write({ rates, marketRates, ratesError, ...(ratesError ? {} : { ratesUpdatedAt: now.toISOString() }) });
  return { updated: !ratesError };
}

export function startExchangeRateJob(intervalMinutes = 60) {
  const run = () => refreshExchangeRates().catch((err) => console.error('[qlc] tipo de cambio', err.message));
  run();
  return setInterval(run, intervalMinutes * 60000);
}

const missingRequirements = (settings, currencies) => {
  const missing = [];
  if (!settings.encryptedToken) missing.push('el Access Token');
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
    testPayerEmail: settings.testPayerEmail || '',
    hasWebhookSecret: !!settings.encryptedWebhookSecret,
    testMode: isTestToken(token) || !!settings.account?.testUser,
    encryptionReady: !!env.tokenEncryptionKey,
    account: settings.account ? { nickname: settings.account.nickname, siteId: settings.account.siteId } : null,
    chargeCurrency: target,
    rates: settings.rates || {},
    marketRates: settings.marketRates || {},
    rateMarkup: RATE_MARKUP,
    ratesUpdatedAt: settings.ratesUpdatedAt,
    ratesError: settings.ratesError,
    ratesStale: !settings.ratesUpdatedAt || Date.now() - new Date(settings.ratesUpdatedAt).getTime() > RATES_STALE_MS,
    ratesNeeded: target ? currencies.filter((c) => c !== target) : [],
    lastTest: settings.lastTest,
    webhookUrl: `${env.backendUrl}/api/webhooks/mercadopago`,
    missing: missingRequirements(settings, currencies),
  };
}

export async function savePaymentSettings({ accessToken, webhookSecret, testPayerEmail, enabled }) {
  const changes = {};
  if (testPayerEmail !== undefined) changes.testPayerEmail = testPayerEmail || null;
  if (accessToken || webhookSecret) {
    if (!env.tokenEncryptionKey) throw badRequest('Falta TOKEN_ENCRYPTION_KEY en el servidor para guardar las credenciales cifradas');
  }
  if (accessToken) {
    Object.assign(changes, { encryptedToken: encryptSecret(accessToken), lastTest: null, account: null, enabled: false });
  }
  if (webhookSecret) changes.encryptedWebhookSecret = encryptSecret(webhookSecret);
  let next = await write(changes);
  if (enabled === true) {
    await refreshExchangeRates();
    next = await paymentSettings();
    const missing = missingRequirements(next, await offerCurrencies());
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
    await refreshExchangeRates(fetcher);
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

import { prisma } from '../../config/prisma.js';
import { badRequest, conflict } from '../../utils/httpError.js';
import { round2 } from '../../utils/money.js';
import { driveConnected } from '../google/drive.js';

const KEY = 'bitget';
export const BITGET_CURRENCY = 'USDT';
const PARITY = ['USD', 'USDT'];
const DEFAULTS = { enabled: false, uid: null, instructions: '', rates: {} };
let cache = null;

export async function bitgetSettings() {
  if (cache) return cache;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  cache = { ...DEFAULTS, ...(row?.value || {}) };
  return cache;
}

async function write(changes) {
  const value = { ...(await bitgetSettings()), ...changes };
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  cache = null;
  return bitgetSettings();
}

export const resetBitgetCache = () => {
  cache = null;
};

const offerCurrencies = async () => {
  const rows = await prisma.productOffer.findMany({ where: { active: true }, select: { currency: true }, distinct: ['currency'] });
  return rows.map((r) => String(r.currency).toUpperCase());
};

const rateOf = (rates, currency) => (PARITY.includes(currency) && !(Number(rates?.[currency]) > 0) ? 1 : Number(rates?.[currency]));

async function missingRequirements(settings, currencies) {
  const missing = [];
  if (!settings.uid) missing.push('el UID de Bitget');
  if (!(await driveConnected())) missing.push('conectar Google Drive en Integraciones para guardar los comprobantes');
  for (const c of currencies) if (!(rateOf(settings.rates, c) > 0)) missing.push(`el tipo de cambio de ${c} a USDT`);
  return missing;
}

export async function bitgetSettingsView() {
  const settings = await bitgetSettings();
  const currencies = await offerCurrencies();
  return {
    enabled: !!settings.enabled,
    uid: settings.uid || '',
    instructions: settings.instructions || '',
    currency: BITGET_CURRENCY,
    rates: settings.rates || {},
    ratesNeeded: currencies.filter((c) => !PARITY.includes(c)),
    missing: await missingRequirements(settings, currencies),
  };
}

export async function saveBitgetSettings({ uid, instructions, rates, enabled }) {
  const changes = {};
  if (uid !== undefined) changes.uid = uid || null;
  if (instructions !== undefined) changes.instructions = instructions || '';
  if (rates) changes.rates = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k.toUpperCase(), Number(v)]).filter(([, v]) => v > 0));
  if (uid === '') changes.enabled = false;
  const next = await write(changes);
  if (enabled === true) {
    const missing = await missingRequirements(next, await offerCurrencies());
    if (missing.length) throw badRequest(`Para activar Bitget falta: ${missing.join(', ')}.`);
  }
  if (enabled !== undefined) await write({ enabled: !!enabled });
  return bitgetSettingsView();
}

export async function bitgetQuote(amount, currency) {
  const settings = await bitgetSettings();
  if (!settings.enabled) throw conflict('Esta forma de pago no está disponible');
  if (amount === null || amount === undefined) throw conflict('Este acceso todavía no tiene precio definido');
  const source = String(currency).toUpperCase();
  const rate = rateOf(settings.rates, source);
  if (!(rate > 0)) throw conflict(`Falta el tipo de cambio de ${source} a USDT. Configúralo en Pasarela de pago.`);
  return { amount: round2(Number(amount) * rate), currency: BITGET_CURRENCY };
}

export async function publicBitgetInfo() {
  const settings = await bitgetSettings();
  if (!settings.enabled) return null;
  const rates = Object.fromEntries((await offerCurrencies()).map((c) => [c, rateOf(settings.rates, c)]));
  return { uid: settings.uid, instructions: settings.instructions || '', currency: BITGET_CURRENCY, rates, whole: false };
}

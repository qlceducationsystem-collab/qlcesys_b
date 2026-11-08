import QRCode from 'qrcode';
import { prisma } from '../../config/prisma.js';
import { badRequest, conflict } from '../../utils/httpError.js';
import { round2 } from '../../utils/money.js';
import { driveConnected } from '../google/drive.js';

const KEY = 'bitget';
export const BITGET_CURRENCY = 'USDT';
const PARITY = ['USD', 'USDT'];
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;
export const WALLET_NETWORKS = {
  SOL: { label: 'Solana (SPL)', pattern: BASE58 },
  TRC20: { label: 'Tron (TRC20)', pattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ },
  ERC20: { label: 'Ethereum (ERC20)', pattern: EVM },
  BEP20: { label: 'BNB Smart Chain (BEP20)', pattern: EVM },
  POLYGON: { label: 'Polygon', pattern: EVM },
  ARBITRUM: { label: 'Arbitrum One', pattern: EVM },
};
const DEFAULTS = { enabled: false, uid: null, instructions: '', rates: {}, walletAddress: '9i9gD2LFJ5TnfrFAY3rACnE3GWgqjkrWLXj3NyVEHbD', walletNetwork: null };
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
  if (!settings.uid && !(settings.walletAddress && settings.walletNetwork)) missing.push('el UID de Bitget o la dirección de wallet con su red');
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
    walletAddress: settings.walletAddress || '',
    walletNetwork: settings.walletNetwork || '',
    networks: Object.entries(WALLET_NETWORKS).map(([value, n]) => ({ value, label: n.label })),
    instructions: settings.instructions || '',
    currency: BITGET_CURRENCY,
    rates: settings.rates || {},
    ratesNeeded: currencies.filter((c) => !PARITY.includes(c)),
    missing: await missingRequirements(settings, currencies),
  };
}

export async function saveBitgetSettings({ uid, instructions, rates, enabled, walletAddress, walletNetwork }) {
  const current = await bitgetSettings();
  const nextAddress = walletAddress === undefined ? current.walletAddress : walletAddress || null;
  const nextNetwork = walletNetwork === undefined ? current.walletNetwork : walletNetwork || null;
  if (nextAddress && nextNetwork && !WALLET_NETWORKS[nextNetwork].pattern.test(nextAddress)) {
    throw badRequest(`Esa dirección no corresponde a la red ${WALLET_NETWORKS[nextNetwork].label}. Revisa la red antes de guardar: enviar por otra red puede perder los fondos.`);
  }
  const changes = {};
  if (walletAddress !== undefined) changes.walletAddress = nextAddress;
  if (walletNetwork !== undefined) changes.walletNetwork = nextNetwork;
  if (uid !== undefined) changes.uid = uid || null;
  if (instructions !== undefined) changes.instructions = instructions || '';
  if (rates) changes.rates = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k.toUpperCase(), Number(v)]).filter(([, v]) => v > 0));
  if (uid === '' && !(nextAddress && nextNetwork)) changes.enabled = false;
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

export async function publicWallet() {
  const { walletAddress, walletNetwork } = await bitgetSettings();
  if (!walletAddress || !walletNetwork) return null;
  return { address: walletAddress, network: WALLET_NETWORKS[walletNetwork].label, qr: await QRCode.toDataURL(walletAddress, { margin: 1, width: 240 }) };
}

export async function publicBitgetInfo() {
  const settings = await bitgetSettings();
  if (!settings.enabled) return null;
  const rates = Object.fromEntries((await offerCurrencies()).map((c) => [c, rateOf(settings.rates, c)]));
  return { uid: settings.uid, instructions: settings.instructions || '', currency: BITGET_CURRENCY, rates, whole: false, wallet: await publicWallet() };
}

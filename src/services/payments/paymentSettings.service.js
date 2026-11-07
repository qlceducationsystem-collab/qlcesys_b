import { prisma } from '../../config/prisma.js';
import { decryptSecret } from '../../utils/crypto.js';

const KEY = 'mercadopago';
const DEFAULTS = { encryptedToken: null, encryptedWebhookSecret: null };
let cache = null;

export async function paymentSettings() {
  if (cache) return cache;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  cache = { ...DEFAULTS, ...(row?.value || {}) };
  return cache;
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

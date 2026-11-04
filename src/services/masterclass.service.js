import { readFile } from 'node:fs/promises';
import { prisma } from '../config/prisma.js';
import { canReadMasterclass } from '../domain/access.js';
import { forbidden, notFound } from '../utils/httpError.js';
import { publicOffer } from './access.service.js';

const DIR = new URL('../content/masterclass/', import.meta.url);
const KEY = 'masterclass';
export const MASTERCLASS_DEFAULTS = { includedWithFull: true };
const cache = new Map();

export async function masterclassSettings() {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  return { ...MASTERCLASS_DEFAULTS, ...(row?.value || {}) };
}

export async function saveMasterclassSettings({ includedWithFull }) {
  const value = { includedWithFull: !!includedWithFull };
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return masterclassSettings();
}

export async function masterclassStatus(access, asAdmin = false) {
  const [settings, offer] = await Promise.all([masterclassSettings(), prisma.productOffer.findUnique({ where: { code: 'MASTERCLASS' } })]);
  const available = asAdmin || canReadMasterclass(access, settings.includedWithFull);
  return { available, includedWithFull: settings.includedWithFull, offer: offer?.active ? publicOffer(offer) : null };
}

export async function masterclassBlocks(number) {
  if (!cache.has(number)) {
    const raw = await readFile(new URL(`m${number}.json`, DIR), 'utf8').catch(() => null);
    if (raw === null) throw notFound('Este módulo todavía no tiene Masterclass');
    cache.set(number, JSON.parse(raw));
  }
  return cache.get(number);
}

export async function readMasterclass(access, asAdmin, number) {
  const status = await masterclassStatus(access, asAdmin);
  if (!status.available) throw forbidden(status.offer ? 'La Masterclass se adquiere por separado' : 'La Masterclass está disponible con el acceso completo');
  return { number, blocks: await masterclassBlocks(number) };
}

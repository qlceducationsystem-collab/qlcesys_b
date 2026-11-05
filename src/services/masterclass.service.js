import { readFile } from 'node:fs/promises';
import { prisma } from '../config/prisma.js';
import { ACTIVE_MODULES, MARKET_MODULES, canReadMasterclass, prerequisiteOf } from '../domain/access.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/httpError.js';
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

const moduleOffer = (n) => prisma.productOffer.findUnique({ where: { code: `MASTERCLASS_M${n}` } });

async function completedSet(userId) {
  const [mc, progress] = await Promise.all([
    prisma.masterclassProgress.findMany({ where: { userId }, select: { moduleNumber: true } }),
    prisma.moduleProgress.findMany({ where: { userId, status: 'COMPLETED' }, select: { module: { select: { month: true } } } }),
  ]);
  return new Set([...mc.map((m) => m.moduleNumber), ...progress.map((p) => p.module.month)]);
}

export async function masterclassStatus(access, asAdmin = false, number = null, userId = null) {
  const settings = await masterclassSettings();
  const available = asAdmin || canReadMasterclass(access, settings.includedWithFull, number);
  const offer = number ? await moduleOffer(number) : null;
  const done = userId && number ? await completedSet(userId) : null;
  const previousNumber = number && number > 1 ? prerequisiteOf(number) : null;
  const previousDone = !previousNumber || asAdmin || (done ? done.has(previousNumber) : false);
  const expiresAt = number ? (access.masterclassModules || []).find((m) => m.moduleNumber === number)?.expiresAt || null : null;
  return {
    available,
    includedWithFull: settings.includedWithFull,
    offer: offer?.active ? publicOffer(offer) : null,
    canBuy: !available && !!offer?.active && previousDone,
    previousDone,
    previousNumber,
    optional: MARKET_MODULES.includes(number),
    completed: done ? done.has(number) : false,
    expiresAt,
  };
}

export async function masterclassBlocks(number) {
  if (!cache.has(number)) {
    const raw = await readFile(new URL(`m${number}.json`, DIR), 'utf8').catch(() => null);
    if (raw === null) throw notFound('Este módulo todavía no tiene Masterclass');
    cache.set(number, JSON.parse(raw));
  }
  return cache.get(number);
}

export async function readMasterclass(access, asAdmin, number, userId) {
  const status = await masterclassStatus(access, asAdmin, number, userId);
  if (!status.available) throw forbidden(status.offer ? 'La Masterclass de este módulo se adquiere por separado' : 'La Masterclass está disponible con el acceso completo');
  return { number, blocks: await masterclassBlocks(number) };
}

export async function masterclassCatalog(access, asAdmin, userId) {
  const [settings, modules, offers, done] = await Promise.all([
    masterclassSettings(),
    prisma.academyModule.findMany({ where: { month: { in: ACTIVE_MODULES } }, orderBy: { month: 'asc' }, select: { month: true, title: true } }),
    prisma.productOffer.findMany({ where: { code: { in: ACTIVE_MODULES.map((n) => `MASTERCLASS_M${n}`) } } }),
    completedSet(userId),
  ]);
  return modules.map((m) => {
    const n = m.month;
    const available = asAdmin || canReadMasterclass(access, settings.includedWithFull, n);
    const offer = offers.find((o) => o.code === `MASTERCLASS_M${n}`);
    const previousNumber = n > 1 ? prerequisiteOf(n) : null;
    const previousDone = !previousNumber || done.has(previousNumber) || asAdmin;
    const expiresAt = (access.masterclassModules || []).find((x) => x.moduleNumber === n)?.expiresAt || null;
    return {
      number: n,
      title: m.title,
      completed: done.has(n),
      available,
      expiresAt,
      previousDone,
      previousNumber,
      optional: MARKET_MODULES.includes(n),
      offer: offer?.active ? publicOffer(offer) : null,
      state: available ? 'AVAILABLE' : !previousDone ? 'LOCKED_ORDER' : offer?.active ? 'PURCHASABLE' : 'LOCKED',
    };
  });
}

export async function completeMasterclass(access, asAdmin, userId, number) {
  const status = await masterclassStatus(access, asAdmin, number, userId);
  if (!status.available) throw forbidden('No tienes acceso a esta Masterclass');
  await prisma.masterclassProgress.upsert({ where: { userId_moduleNumber: { userId, moduleNumber: number } }, create: { userId, moduleNumber: number }, update: {} });
  return { ok: true };
}

export async function assertCanBuyMasterclass(userId, offer, access) {
  const n = offer.moduleNumber;
  if (!n) return;
  const settings = await masterclassSettings();
  if (canReadMasterclass(access, settings.includedWithFull, n)) throw conflict('Ya tienes acceso a la Masterclass de este módulo');
  const previous = n > 1 ? prerequisiteOf(n) : null;
  if (previous && !(await completedSet(userId)).has(previous)) throw badRequest(`Primero completa la Masterclass del Módulo ${previous}: los módulos no se pueden saltar`);
}

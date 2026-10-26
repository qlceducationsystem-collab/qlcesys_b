import { prisma } from '../config/prisma.js';

const KEY = 'copytrading-notice';
const CACHE_MS = 12 * 60 * 60 * 1000;

export const NOTICE_DEFAULTS = {
  active: true,
  metrics: { returnPct: 17, days: 180, wins: 50, losses: 0, hitRate: 100, drawdown: 17 },
  bitgetUrl: null,
  infoUrl: 'https://www.qlctrade.net/',
  updatedAt: null,
};

let cache = null;

const fromRow = (row) => ({
  active: row.active,
  metrics: { ...NOTICE_DEFAULTS.metrics, ...(row.items || {}) },
  bitgetUrl: row.primaryCtaTarget || null,
  infoUrl: row.secondaryCtaTarget || null,
  updatedAt: row.updatedAt,
});

export async function getLoginNotice() {
  if (cache && cache.exp > Date.now()) return cache.value;
  const row = await prisma.publicSection.findUnique({ where: { key: KEY } });
  const value = row ? fromRow(row) : NOTICE_DEFAULTS;
  cache = { value, exp: Date.now() + CACHE_MS };
  return value;
}

export async function saveLoginNotice(adminId, { active, metrics, bitgetUrl, infoUrl }) {
  const data = { active, items: metrics, primaryCtaTarget: bitgetUrl, secondaryCtaTarget: infoUrl, updatedById: adminId };
  const row = await prisma.publicSection.upsert({
    where: { key: KEY },
    create: { key: KEY, navLabel: 'Aviso de inicio de sesión', position: 0, title: 'QLC Copytrading', ...data },
    update: data,
  });
  cache = null;
  return fromRow(row);
}

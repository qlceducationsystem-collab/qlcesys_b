import { prisma } from '../config/prisma.js';
import { summarizeAccess } from '../domain/access.js';

export const loadGrants = (userId, db = prisma) => db.accessGrant.findMany({ where: { userId, active: true } });

export async function getAccess(userId, db = prisma) {
  return summarizeAccess(await loadGrants(userId, db));
}

export const ADMIN_ACCESS = { full: { active: true, expiresAt: null }, tools: [1, 2, 3, 4, 5, 6], hasAny: true, mode: 'FULL' };

export const accessFor = (req) => (req.asAdmin ? ADMIN_ACCESS : getAccess(req.subjectId));

export const publicOffer = (o) => ({
  code: o.code,
  name: o.name,
  description: o.description,
  type: o.type,
  moduleNumber: o.moduleNumber,
  price: o.price === null || o.price === undefined ? null : Number(o.price),
  currency: o.currency,
  accessDays: o.accessDays,
  active: o.active,
});

const OFFERS_TTL_MS = 12 * 60 * 60 * 1000;
let offersCache = { data: null, at: 0 };

export const invalidateOffersCache = () => {
  offersCache = { data: null, at: 0 };
};

export async function cachedActiveOffers() {
  if (offersCache.data && Date.now() - offersCache.at < OFFERS_TTL_MS) return offersCache.data;
  try {
    const data = await listOffers();
    offersCache = { data, at: Date.now() };
    return data;
  } catch (err) {
    if (offersCache.data) return offersCache.data;
    throw err;
  }
}

export const listOffers = async ({ includeInactive = false } = {}) =>
  (await prisma.productOffer.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  })).map(publicOffer);

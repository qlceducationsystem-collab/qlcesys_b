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

export const listOffers = async ({ includeInactive = false } = {}) =>
  (await prisma.productOffer.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  })).map(publicOffer);

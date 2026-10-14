export const BLOCK1_MODULES = [1, 2, 3, 4, 5, 6];
export const MARKET_MODULES = [4, 5, 6];

export const isGrantActive = (grant, now = new Date()) =>
  !!grant?.active &&
  new Date(grant.startsAt) <= now &&
  (!grant.expiresAt || new Date(grant.expiresAt) > now);

export function summarizeAccess(grants = [], now = new Date()) {
  const active = grants.filter((g) => isGrantActive(g, now));
  const fullGrants = active.filter((g) => g.accessType === 'FULL_ANNUAL');
  const fullExpiry = fullGrants.reduce((max, g) => (!max || new Date(g.expiresAt) > max ? new Date(g.expiresAt) : max), null);
  const tools = [...new Set(active.filter((g) => g.accessType === 'TOOL_ONLY').map((g) => g.moduleNumber))].sort((a, b) => a - b);
  return {
    full: fullGrants.length ? { active: true, expiresAt: fullExpiry } : null,
    tools,
    hasAny: active.length > 0,
    mode: fullGrants.length ? 'FULL' : tools.length ? 'TOOLS' : 'NONE',
  };
}

export const canUseTool = (access, moduleNumber) => !!access.full || access.tools.includes(moduleNumber);
export const canReadAcademy = (access) => !!access.full;

export function moduleState(moduleNumber, { access, completed = [], route = null, filterPassed = false }) {
  const done = new Set(completed);
  if (done.has(moduleNumber)) return 'COMPLETED';
  if (!canUseTool(access, moduleNumber)) return 'LOCKED_ACCESS';
  const isMarket = MARKET_MODULES.includes(moduleNumber);
  if (isMarket && !filterPassed) return 'LOCKED_FILTER';
  if (!access.full) return 'AVAILABLE';
  if (moduleNumber === 4 && route !== 'MARKETS') return 'LOCKED_ROUTE';
  if (moduleNumber > 1 && !done.has(moduleNumber - 1)) return 'LOCKED_ORDER';
  return 'AVAILABLE';
}

export const isModuleOpen = (state) => state === 'AVAILABLE' || state === 'COMPLETED';

export const canChooseRoute = (access, completed = []) => !access.full ? access.hasAny : completed.includes(3);

export function grantWindow(offer, existingFullExpiry, now = new Date()) {
  if (offer.type !== 'FULL_ANNUAL') return { startsAt: now, expiresAt: null };
  const startsAt = existingFullExpiry && existingFullExpiry > now ? existingFullExpiry : now;
  const days = offer.accessDays || 365;
  return { startsAt, expiresAt: new Date(startsAt.getTime() + days * 86400000) };
}

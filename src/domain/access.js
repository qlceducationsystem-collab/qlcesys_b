export const BLOCK1_MODULES = [1, 2, 3, 4, 5, 6];
export const BLOCK2_MODULES = [7, 8, 9, 10, 11, 12];
export const ACTIVE_MODULES = [...BLOCK1_MODULES, ...BLOCK2_MODULES];
export const MARKET_MODULES = [4, 5, 6];

export const prerequisiteOf = (moduleNumber) => (moduleNumber === 7 ? 3 : moduleNumber - 1);

export const isGrantActive = (grant, now = new Date()) =>
  !!grant?.active &&
  new Date(grant.startsAt) <= now &&
  (!grant.expiresAt || new Date(grant.expiresAt) > now);

export const grantTools = (grant) => (grant.moduleNumber ? [grant.moduleNumber] : ACTIVE_MODULES);

export function summarizeAccess(grants = [], now = new Date()) {
  const active = grants.filter((g) => isGrantActive(g, now));
  const fullGrants = active.filter((g) => g.accessType === 'FULL_ANNUAL');
  const fullExpiry = fullGrants.reduce((max, g) => (!max || new Date(g.expiresAt) > max ? new Date(g.expiresAt) : max), null);
  const toolGrants = active.filter((g) => g.accessType === 'TOOL_ONLY');
  const masterclassGrants = active.filter((g) => g.accessType === 'MASTERCLASS');
  const masterclassAll = masterclassGrants.some((g) => !g.moduleNumber);
  const masterclassModules = masterclassAll ? ACTIVE_MODULES : [...new Set(masterclassGrants.map((g) => g.moduleNumber))].sort((a, b) => a - b);
  const masterclassExpiry = (n) => latestDate(masterclassGrants.filter((g) => !g.moduleNumber || g.moduleNumber === n).map((g) => g.expiresAt));
  const accessGrants = active.filter((g) => g.accessType === 'FULL_ANNUAL' || g.accessType === 'TOOL_ONLY');
  const tools = [...new Set(toolGrants.flatMap(grantTools))].sort((a, b) => a - b);
  const toolExpiry = (n) => {
    const list = toolGrants.filter((g) => grantTools(g).includes(n));
    return list.some((g) => !g.expiresAt) ? null : latestDate(list.map((g) => g.expiresAt));
  };
  return {
    full: fullGrants.length ? { active: true, expiresAt: fullExpiry } : null,
    tools,
    toolAccess: tools.map((n) => ({ moduleNumber: n, expiresAt: toolExpiry(n) })),
    masterclass: masterclassGrants.length ? { active: true, expiresAt: latestDate(masterclassGrants.map((g) => g.expiresAt)), all: masterclassAll } : null,
    masterclassModules: masterclassModules.map((n) => ({ moduleNumber: n, expiresAt: masterclassExpiry(n) })),
    hasAny: accessGrants.length > 0,
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
  const previous = prerequisiteOf(moduleNumber);
  const followsOrder = moduleNumber > 1 && canUseTool(access, previous);
  if (moduleNumber === 4 && followsOrder && route !== 'MARKETS') return 'LOCKED_ROUTE';
  if (followsOrder && !done.has(previous)) return 'LOCKED_ORDER';
  return 'AVAILABLE';
}

export const isModuleOpen = (state) => state === 'AVAILABLE' || state === 'COMPLETED';

export const canChooseRoute = (access, completed = []) => (canUseTool(access, 3) ? completed.includes(3) : access.hasAny);

export const DEFAULT_ACCESS_DAYS = { FULL_ANNUAL: 365, TOOL_ONLY: 30, MASTERCLASS: 365 };

export const canReadMasterclass = (access, includedWithFull, moduleNumber = null) =>
  (includedWithFull && !!access.full)
  || !!access.masterclass?.all
  || (moduleNumber !== null && (access.masterclassModules || []).some((m) => m.moduleNumber === moduleNumber));

function latestDate(dates) {
  return dates.filter(Boolean).map((d) => new Date(d)).reduce((max, d) => (!max || d > max ? d : max), null);
}

export function renewalBase(grants, offer, now = new Date()) {
  const same = grants.filter((g) => g.active && g.accessType === offer.type && ((offer.type !== 'TOOL_ONLY' && offer.type !== 'MASTERCLASS') || g.moduleNumber === offer.moduleNumber));
  const latest = latestDate(same.map((g) => g.expiresAt));
  return latest && latest > now ? latest : null;
}

export const SUBSCRIPTION_GRACE_DAYS = 3;
export const RECURRING_OFFER_TYPES = ['TOOL_ONLY', 'FULL_ANNUAL'];

function addCycle(date, cycle) {
  const months = cycle === 'YEARLY' ? 12 : 1;
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
}

export function subscriptionWindow(cycle, existingExpiry, now = new Date()) {
  if (existingExpiry && existingExpiry > now) return { startsAt: existingExpiry, expiresAt: addCycle(existingExpiry, cycle) };
  return { startsAt: now, expiresAt: new Date(addCycle(now, cycle).getTime() + SUBSCRIPTION_GRACE_DAYS * 86400000) };
}

export function grantWindow(offer, existingExpiry, now = new Date()) {
  const startsAt = existingExpiry && existingExpiry > now ? existingExpiry : now;
  const days = offer.accessDays || DEFAULT_ACCESS_DAYS[offer.type] || 30;
  return { startsAt, expiresAt: new Date(startsAt.getTime() + days * 86400000) };
}

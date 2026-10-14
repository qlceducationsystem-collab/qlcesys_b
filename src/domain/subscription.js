// Reglas de membresía y desbloqueo progresivo. Funciones puras.
export const GRACE_DAYS = 3;
export const TOTAL_MODULES = 12;
const DAY = 24 * 60 * 60 * 1000;

// Estado efectivo: un ACTIVE cuyo siguiente cobro venció (más gracia) ya no da acceso.
export function effectiveStatus(sub, now = new Date()) {
  if (!sub) return 'NONE';
  if (sub.status === 'ACTIVE' && sub.nextBillingDate) {
    const limit = new Date(sub.nextBillingDate).getTime() + GRACE_DAYS * DAY;
    if (now.getTime() > limit) return 'PAST_DUE';
  }
  return sub.status;
}

export const hasAccess = (sub, now = new Date()) => effectiveStatus(sub, now) === 'ACTIVE' && !!sub.activatedAt;

// Mes de suscripción (1 = primer mes) contado desde la fecha de activación.
export function subscriptionMonth(activatedAt, now = new Date()) {
  if (!activatedAt) return 0;
  const a = new Date(activatedAt);
  if (now < a) return 1;
  let months = (now.getUTCFullYear() - a.getUTCFullYear()) * 12 + (now.getUTCMonth() - a.getUTCMonth());
  if (now.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(months, 0) + 1;
}

export function unlockState(activatedAt, now = new Date()) {
  const currentMonth = subscriptionMonth(activatedAt, now);
  const unlocked = Math.min(currentMonth, TOTAL_MODULES);
  return { currentMonth, unlocked, pending: TOTAL_MODULES - unlocked };
}

export const isModuleUnlocked = (moduleMonth, activatedAt, now = new Date()) =>
  !!activatedAt && moduleMonth <= unlockState(activatedAt, now).unlocked;

export function addMonths(date, n) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

// Mapeo de estados de Mercado Pago → estados internos.
export function mapPreapprovalStatus(mpStatus) {
  return { pending: 'PENDING', authorized: 'ACTIVE', paused: 'PAST_DUE', cancelled: 'CANCELLED' }[mpStatus] || null;
}

export function mapPaymentStatus(mpStatus) {
  return (
    {
      approved: 'APPROVED',
      authorized: 'PENDING',
      pending: 'PENDING',
      in_process: 'PENDING',
      rejected: 'REJECTED',
      cancelled: 'CANCELLED',
      refunded: 'REFUNDED',
      charged_back: 'REFUNDED',
    }[mpStatus] || 'PENDING'
  );
}

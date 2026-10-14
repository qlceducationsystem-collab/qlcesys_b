import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveStatus, hasAccess, isModuleUnlocked, mapPaymentStatus, mapPreapprovalStatus, subscriptionMonth, unlockState } from '../src/domain/subscription.js';

const d = (s) => new Date(`${s}T12:00:00Z`);

test('Mes de suscripción se cuenta desde la fecha de activación', () => {
  assert.equal(subscriptionMonth(null), 0);
  assert.equal(subscriptionMonth(d('2026-01-15'), d('2026-01-15')), 1);
  assert.equal(subscriptionMonth(d('2026-01-15'), d('2026-02-14')), 1);
  assert.equal(subscriptionMonth(d('2026-01-15'), d('2026-02-15')), 2);
  assert.equal(subscriptionMonth(d('2026-01-15'), d('2027-01-15')), 13);
});

test('Desbloqueo mensual progresivo, máximo 12 módulos', () => {
  assert.deepEqual(unlockState(d('2026-01-15'), d('2026-03-20')), { currentMonth: 3, unlocked: 3, pending: 9 });
  assert.equal(unlockState(d('2025-01-01'), d('2027-06-01')).unlocked, 12);
  assert.equal(isModuleUnlocked(1, d('2026-01-15'), d('2026-01-15')), true);
  assert.equal(isModuleUnlocked(2, d('2026-01-15'), d('2026-01-20')), false);
  assert.equal(isModuleUnlocked(1, null), false);
});

test('Acceso depende del estado real de la suscripción', () => {
  const now = d('2026-05-10');
  assert.equal(hasAccess(null, now), false);
  assert.equal(hasAccess({ status: 'PENDING', activatedAt: null }, now), false);
  assert.equal(hasAccess({ status: 'ACTIVE', activatedAt: d('2026-05-01'), nextBillingDate: d('2026-06-01') }, now), true);
  assert.equal(hasAccess({ status: 'CANCELLED', activatedAt: d('2026-01-01') }, now), false);
  assert.equal(hasAccess({ status: 'ACTIVE', activatedAt: null }, now), false);
});

test('Suscripción vencida (cobro no realizado tras gracia) → PAST_DUE sin acceso', () => {
  const sub = { status: 'ACTIVE', activatedAt: d('2026-01-01'), nextBillingDate: d('2026-04-01') };
  assert.equal(effectiveStatus(sub, d('2026-04-02')), 'ACTIVE');
  assert.equal(effectiveStatus(sub, d('2026-04-10')), 'PAST_DUE');
  assert.equal(hasAccess(sub, d('2026-04-10')), false);
});

test('Mapeo de estados de Mercado Pago', () => {
  assert.equal(mapPreapprovalStatus('authorized'), 'ACTIVE');
  assert.equal(mapPreapprovalStatus('cancelled'), 'CANCELLED');
  assert.equal(mapPaymentStatus('approved'), 'APPROVED');
  assert.equal(mapPaymentStatus('rejected'), 'REJECTED');
  assert.equal(mapPaymentStatus('desconocido'), 'PENDING');
});

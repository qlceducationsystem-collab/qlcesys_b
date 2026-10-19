import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canChooseRoute, grantWindow, moduleState, renewalBase, summarizeAccess } from '../src/domain/access.js';

const now = new Date('2026-10-14T12:00:00Z');
const day = 86400000;
const full = { active: true, accessType: 'FULL_ANNUAL', startsAt: new Date(now - day), expiresAt: new Date(+now + 300 * day) };
const tool = (n) => ({ active: true, accessType: 'TOOL_ONLY', moduleNumber: n, startsAt: new Date(now - day), expiresAt: null });

test('Acceso anual activo, vencido y herramientas sueltas', () => {
  assert.equal(summarizeAccess([full], now).mode, 'FULL');
  assert.equal(summarizeAccess([{ ...full, expiresAt: new Date(now - 1) }], now).mode, 'NONE');
  const t = summarizeAccess([tool(2), tool(1), tool(2)], now);
  assert.deepEqual(t.tools, [1, 2]);
  assert.equal(t.mode, 'TOOLS');
  assert.equal(summarizeAccess([{ ...tool(1), active: false }], now).hasAny, false);
});

test('Progresión del bloque 1 con acceso completo', () => {
  const access = summarizeAccess([full], now);
  assert.equal(moduleState(1, { access }), 'AVAILABLE');
  assert.equal(moduleState(2, { access }), 'LOCKED_ORDER');
  assert.equal(moduleState(2, { access, completed: [1] }), 'AVAILABLE');
  assert.equal(moduleState(4, { access, completed: [1, 2, 3] }), 'LOCKED_FILTER');
  assert.equal(moduleState(4, { access, completed: [1, 2, 3], filterPassed: true }), 'LOCKED_ROUTE');
  assert.equal(moduleState(4, { access, completed: [1, 2, 3], filterPassed: true, route: 'MARKETS' }), 'AVAILABLE');
  assert.equal(moduleState(5, { access, completed: [1, 2, 3], filterPassed: true, route: 'MARKETS' }), 'LOCKED_ORDER');
  assert.equal(canChooseRoute(access, [1, 2]), false);
  assert.equal(canChooseRoute(access, [1, 2, 3]), true);
});

test('Solo herramientas: cada herramienta requiere su compra; mercados requieren filtro', () => {
  const access = summarizeAccess([tool(3), tool(5)], now);
  assert.equal(moduleState(1, { access }), 'LOCKED_ACCESS');
  assert.equal(moduleState(3, { access }), 'AVAILABLE');
  assert.equal(moduleState(5, { access }), 'LOCKED_FILTER');
  assert.equal(moduleState(5, { access, filterPassed: true }), 'AVAILABLE');
  assert.equal(moduleState(1, { access: summarizeAccess([], now) }), 'LOCKED_ACCESS');
});

test('Ventana del acceso anual: renovación se suma al vencimiento vigente', () => {
  const offer = { type: 'FULL_ANNUAL', accessDays: 365 };
  const w = grantWindow(offer, null, now);
  assert.equal(w.expiresAt - w.startsAt, 365 * day);
  const renewal = grantWindow(offer, new Date(+now + 10 * day), now);
  assert.equal(+renewal.startsAt, +now + 10 * day);
  const monthly = grantWindow({ type: 'TOOL_ONLY', accessDays: 30 }, null, now);
  assert.equal(monthly.expiresAt - monthly.startsAt, 30 * day);
});

test('Herramientas mensuales: vencen a los 30 días y la renovación se suma por módulo', () => {
  const tool7 = { type: 'TOOL_ONLY', moduleNumber: 7, accessDays: 30 };
  const grants = [
    { active: true, accessType: 'TOOL_ONLY', moduleNumber: 7, startsAt: now, expiresAt: new Date(+now + 12 * day) },
    { active: true, accessType: 'TOOL_ONLY', moduleNumber: 8, startsAt: now, expiresAt: new Date(+now + 25 * day) },
  ];
  assert.equal(+renewalBase(grants, tool7, now), +now + 12 * day);
  assert.equal(renewalBase(grants, { ...tool7, moduleNumber: 9 }, now), null);
  const later = new Date(+now + 31 * day);
  assert.equal(summarizeAccess(grants, later).tools.length, 0);
  assert.deepEqual(summarizeAccess(grants, now).toolAccess.map((t) => t.moduleNumber), [7, 8]);
});

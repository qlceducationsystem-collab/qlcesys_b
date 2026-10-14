import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('API (integración)', () => {
  let app;
  let prisma;
  let resolveAttempt;
  const uid = Date.now().toString(36);
  const tokens = {};
  const ids = {};

  const api = (who) => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokens[who]}`);
    return {
      get: (url, h = {}) => auth(request(app).get(url)).set(h),
      post: (url, body, h = {}) => auth(request(app).post(url)).set(h).send(body),
      put: (url, body, h = {}) => auth(request(app).put(url)).set(h).send(body),
      patch: (url, body, h = {}) => auth(request(app).patch(url)).set(h).send(body),
      del: (url, h = {}) => auth(request(app).delete(url)).set(h),
    };
  };

  async function register(key) {
    const res = await request(app).post('/api/auth/register').send({ name: `Cliente ${key}`, email: `${key}-${uid}@test.qlc`, password: 'Password123!', role: 'ADMIN' });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'CLIENT');
    assert.equal(res.body.status, 'SETUP_2FA');
    tokens[key] = (await completeTwoFactor(app, res.body.challengeToken)).token;
    ids[key] = res.body.user.id;
  }

  async function createAdmin(key, adminLevel) {
    const email = `${key}-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email, name: key, role: 'ADMIN', adminLevel, passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
    tokens[key] = (await completeTwoFactor(app, login.body.challengeToken)).token;
  }

  async function buy(who, offerCode, outcome = 'APPROVED') {
    const checkout = await api(who).post('/api/payments/checkout', { offerCode });
    assert.equal(checkout.status, 201);
    return api(who).post(`/api/payments/attempts/${checkout.body.attempt.id}/simulate`, { outcome });
  }

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    ({ createApp: app } = await import('../src/app.js'));
    app = app();
    ({ prisma } = await import('../src/config/prisma.js'));
    ({ resolveAttempt } = await import('../src/services/payments/payment.service.js'));
    await register('a');
    await register('b');
    await register('tools');
    await createAdmin('full', 'FULL');
    await createAdmin('view', 'VIEW');
    await createAdmin('edit', 'EDIT');
  });

  after(async () => prisma?.$disconnect());

  test('Sin acceso no hay área privada; el registro nunca crea administradores', async () => {
    assert.equal((await api('a').get('/api/dashboard')).status, 403);
    assert.equal((await request(app).get('/api/dashboard')).status, 401);
    assert.equal((await api('a').get('/api/admin/clients')).status, 403);
    assert.equal((await api('a').get('/api/academy')).status, 200);
  });

  test('Pago simulado rechazado no otorga acceso; aprobado sí, una sola vez', async () => {
    const rejected = await buy('a', 'FULL_ANNUAL', 'REJECTED');
    assert.equal(rejected.body.attempt.status, 'REJECTED');
    assert.equal(rejected.body.access.hasAny, false);
    const approved = await buy('a', 'FULL_ANNUAL');
    assert.equal(approved.body.access.mode, 'FULL');
    const attemptId = approved.body.attempt.id;
    const again = await resolveAttempt(attemptId, 'APPROVED');
    assert.equal(again.changed, false);
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.a } }), 1);
    assert.equal((await api('a').post(`/api/payments/attempts/${attemptId}/simulate`, { outcome: 'APPROVED' })).status, 400);
  });

  test('M1 guarda datos reales que alimentan el resumen financiero', async () => {
    assert.equal((await api('a').get('/api/academy/modules/2')).status, 403);
    const res = await api('a').put('/api/academy/diagnosis', {
      income: 30000, expenses: 22000, debtPayment: 3000, monthlyInvestment: 3000,
      cash: 50000, investments: 100000, otherAssets: 250000, totalDebt: 80000, emergencyFund: 50000,
      riskTolerance: 'MODERADO', mainGoal: 'CONSTRUIR_PATRIMONIO',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.netWorth, 320000);
    ids.period = res.body.periodId;
    const s = (await api('a').get(`/api/periods/${ids.period}/summary`)).body.summary;
    assert.equal(s.cashflow.income, 30000);
    assert.equal(s.cashflow.expenses, 25000);
    assert.equal(s.balanceSheet.netWorth, 320000);
    assert.equal(s.reconciliation.reconciled, true);
    assert.equal((await api('a').put('/api/academy/modules/1/progress', { status: 'COMPLETED' })).status, 200);
  });

  test('M2 desglosa inversiones sin duplicar patrimonio', async () => {
    const add = await api('a').post('/api/academy/products', { name: 'CETES', productType: 'RENTA_FIJA', capital: 40000, horizon: 'CORTO', liquidityLevel: 'ALTA', perceivedRisk: 'BAJO' });
    assert.equal(add.status, 201);
    ids.asset = add.body.id;
    const s = (await api('a').get(`/api/periods/${ids.period}/summary`)).body.summary;
    assert.equal(s.balanceSheet.netWorth, 320000);
    assert.ok(s.portfolio.products.some((p) => p.name === 'CETES' && p.final === 40000));
    assert.equal(s.portfolio.products.find((p) => p.source === 'M1_INVESTMENTS').final, 60000);
  });

  test('Otro usuario no puede leer ni borrar datos ajenos', async () => {
    await buy('b', 'FULL_ANNUAL');
    assert.equal((await api('b').get(`/api/periods/${ids.period}/summary`)).status, 404);
    assert.equal((await api('b').get(`/api/periods/${ids.period}/summary`, { 'X-Client-Id': ids.a })).status, 404);
    assert.ok([403, 404].includes((await api('b').del(`/api/academy/products/${ids.asset}`)).status));
    assert.equal(await prisma.asset.count({ where: { id: ids.asset } }), 1);
  });

  test('Admin VIEW solo consulta; admin EDIT modifica los mismos registros con auditoría', async () => {
    const h = { 'X-Client-Id': ids.a };
    assert.equal((await api('view').get('/api/academy/products', h)).status, 200);
    const body = { name: 'CETES', productType: 'RENTA_FIJA', capital: 45000, horizon: 'CORTO', liquidityLevel: 'ALTA', perceivedRisk: 'BAJO' };
    assert.equal((await api('view').put(`/api/academy/products/${ids.asset}`, body, h)).status, 403);
    assert.equal((await api('edit').put(`/api/academy/products/${ids.asset}`, { ...body, name: 'CETES 28 días' }, h)).status, 200);
    const log = await prisma.adminAuditLog.findFirst({ where: { clientId: ids.a, module: 'MODULO_2', field: 'name' } });
    assert.equal(log.newValue, 'CETES 28 días');
    const products = (await api('a').get('/api/academy/products')).body.products;
    assert.equal(products[0].capital, 45000);
  });

  test('Ruta y filtro de mercados: criterio exacto y bloqueo de M4', async () => {
    assert.equal((await api('a').put('/api/academy/route', { route: 'MARKETS' })).status, 403);
    await api('a').put('/api/academy/modules/2/progress', { status: 'COMPLETED' });
    await api('a').put('/api/academy/modules/3/progress', { status: 'COMPLETED' });
    assert.equal((await api('a').put('/api/academy/route', { route: 'MARKETS' })).status, 200);
    const fail = await api('a').post('/api/academy/market-filter', { answers: { q1: 1, q2: 1, q3: 0, q4: 1, q5: 1, q6: 0 } });
    assert.equal(fail.body.passed, false);
    assert.equal((await api('a').get('/api/academy/modules/4')).status, 403);
    const pass = await api('a').post('/api/academy/market-filter', { answers: { q1: 1, q2: 1, q3: 1, q4: 1, q5: 1, q6: 0 } });
    assert.equal(pass.body.passed, true);
    assert.equal((await api('a').get('/api/academy/modules/4')).status, 200);
  });

  test('Simulaciones M4–M6 no modifican el patrimonio real', async () => {
    const before = (await api('a').get(`/api/periods/${ids.period}/summary`)).body.summary.balanceSheet.netWorth;
    const m4 = await api('a').post('/api/academy/modules/4/simulate', { input: { capital: 1000, direction: 'LONG', leverage: 50, movePct: 2, favorable: false }, save: true });
    assert.equal(m4.body.result.result, -1000);
    await api('a').put('/api/academy/modules/4/progress', { status: 'COMPLETED' });
    const m5 = await api('a').post('/api/academy/modules/5/simulate', { input: { capital: 1000, direction: 'LONG', leverage: 10, entryPrice: 100000, exitPrice: 102000, costPct: 0.1 }, save: true });
    assert.equal(m5.body.result.netResult, 190);
    assert.equal((await api('a').post('/api/academy/modules/6/simulate', { input: { capital: 1 } })).status, 403);
    await api('a').put('/api/academy/modules/5/progress', { status: 'COMPLETED' });
    const m6 = await api('a').post('/api/academy/modules/6/simulate', { input: { capital: 10000, riskPct: 1, positions: 5, leverage: 5, automation: 'SEMI', monitoring: 'CONTINUOUS' }, save: true });
    assert.equal(m6.body.result.accumulatedRiskMoney, 500);
    const after = (await api('a').get(`/api/periods/${ids.period}/summary`)).body.summary.balanceSheet.netWorth;
    assert.equal(after, before);
    assert.equal(await prisma.educationalSimulation.count({ where: { userId: ids.a } }), 3);
  });

  test('Solo herramientas: herramienta comprada sin academia; las demás bloqueadas', async () => {
    await buy('tools', 'TOOL_M3');
    const m3 = await api('tools').get('/api/academy/modules/3');
    assert.equal(m3.status, 200);
    assert.equal(m3.body.mode, 'TOOL_ONLY');
    assert.equal(m3.body.lesson, null);
    assert.equal((await api('tools').get('/api/academy/modules/1')).status, 403);
    assert.equal((await api('tools').get('/api/dashboard')).status, 200);
  });

  test('Precios y contenido público administrables; precio nulo se mantiene como por definir', async () => {
    assert.equal((await api('edit').put('/api/admin/pricing/TOOL_M1', { name: 'x', price: 10, currency: 'MXN', active: true })).status, 403);
    const upd = await api('full').put('/api/admin/pricing/TOOL_M1', { name: 'Herramienta M1', price: null, currency: 'MXN', active: true });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.price, null);
    const content = await request(app).get('/api/public/content');
    assert.equal(content.status, 200);
    assert.ok(content.body.sections.length >= 1);
    assert.ok(content.body.offers.every((o) => o.price === null || typeof o.price === 'number'));
  });
});

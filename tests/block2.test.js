import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';
import { annualWindow, shiftMonth } from '../src/domain/patrimonial.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('Bloque 2 · M7–M12 (integración)', () => {
  let app;
  let prisma;
  const uid = `b2${Date.now().toString(36)}`;
  const tokens = {};
  const ids = {};
  const state = {};

  const api = (who, clientId) => {
    const auth = (r) => {
      r.set('Authorization', `Bearer ${tokens[who]}`);
      if (clientId) r.set('X-Client-Id', clientId);
      return r;
    };
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body) => auth(request(app).post(url)).send(body),
      put: (url, body) => auth(request(app).put(url)).send(body),
      del: (url) => auth(request(app).delete(url)),
    };
  };

  async function register(key) {
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, legalVersion: '2026-10-18', name: `Cliente ${key}`, email: `${key}-${uid}@test.qlc`, password: 'Password123!' });
    assert.equal(res.status, 201);
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

  async function buy(who, offerCode) {
    const checkout = await api(who).post('/api/payments/checkout', { offerCode });
    assert.equal(checkout.status, 201);
    const res = await api(who).post(`/api/payments/attempts/${checkout.body.attempt.id}/simulate`, { outcome: 'APPROVED' });
    assert.equal(res.status, 200);
  }

  const complete = async (who, n) => {
    const res = await api(who).put(`/api/academy/modules/${n}/progress`, { status: 'COMPLETED', exercise: 'Conclusiones' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  };

  const balanceSheet = async (who) => (await api(who).get(`/api/periods/${state.periodId}/summary`)).body.summary.balanceSheet;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    for (const key of ['p', 'q', 'tool7', 'h']) await register(key);
    await createAdmin('full', 'FULL');
    await createAdmin('view', 'VIEW');
    await buy('p', 'FULL_ANNUAL');
    await buy('q', 'FULL_ANNUAL');
    await buy('tool7', 'TOOLS_ALL');
  });

  after(async () => prisma?.$disconnect());

  test('M7 no depende de M4–M6 pero sí de M3; solo herramientas abre M7 sin academia', async () => {
    assert.equal((await api('p').get('/api/academy/emergency')).status, 403);
    const diagnosis = {
      income: 30000, expenses: 22000, debtPayment: 3000, monthlyInvestment: 2000,
      cash: 36000, investments: 100000, otherAssets: 0, totalDebt: 0, emergencyFund: 36000,
      riskTolerance: 'MODERADO', mainGoal: 'CONSTRUIR_PATRIMONIO',
    };
    const d = await api('p').put('/api/academy/diagnosis', diagnosis);
    assert.equal(d.status, 200);
    state.periodId = d.body.periodId;
    const period = await prisma.financialPeriod.findUnique({ where: { id: state.periodId } });
    state.month = { year: period.year, month: period.month };
    await complete('p', 1);
    const product = await api('p').post('/api/academy/products', { name: 'Fondo de renta fija', productType: 'RENTA_FIJA', capital: 100000, horizon: 'MEDIANO', liquidityLevel: 'MEDIA', perceivedRisk: 'BAJO' });
    state.assetId = product.body.id;
    await complete('p', 2);
    const q = new URLSearchParams(state.month).toString();
    assert.equal((await api('p').get(`/api/academy/budget?${q}`)).status, 403);
    await complete('p', 3);
    assert.equal((await api('p').put('/api/academy/route', { route: 'PATRIMONIAL' })).status, 200);
    const overview = await api('p').get('/api/academy');
    assert.equal(overview.body.block2[0].state, 'AVAILABLE');
    assert.equal(overview.body.block1.find((m) => m.number === 4).state, 'LOCKED_FILTER');
    const toolOnly = await api('tool7').get('/api/academy/modules/7');
    assert.equal(toolOnly.status, 200);
    assert.equal(toolOnly.body.mode, 'TOOL_ONLY');
    assert.equal(toolOnly.body.lesson, null);
    assert.equal((await api('tool7').get('/api/academy/emergency')).status, 200);
  });

  test('M7 valida 100%, lee movimientos reales sin duplicarlos y no convierte el plan en realidad', async () => {
    const lines = [['VIVIENDA', 25], ['ALIMENTACION', 12], ['TRANSPORTE', 8], ['ENTRETENIMIENTO', 7], ['DEUDAS', 10], ['AHORRO', 20], ['INVERSION', 18]].map(([category, percent]) => ({ category, percent }));
    const body = { ...state.month, netIncome: 30000, lines };
    const short = await api('p').put('/api/academy/budget', { ...body, lines: lines.map((l) => (l.category === 'VIVIENDA' ? { ...l, percent: 21 } : l)) });
    assert.equal(short.status, 400);
    assert.match(short.body.error, /Faltan 4\.00%/);
    const over = await api('p').put('/api/academy/budget', { ...body, lines: lines.map((l) => (l.category === 'VIVIENDA' ? { ...l, percent: 30 } : l)) });
    assert.equal(over.status, 400);
    assert.match(over.body.error, /Sobran 5\.00%/);

    const assetsBefore = await prisma.asset.count({ where: { userId: ids.p } });
    const sheetBefore = await balanceSheet('p');
    const saved = await api('p').put('/api/academy/budget', body);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.view.rows.find((r) => r.category === 'VIVIENDA').planned, 7500);
    assert.equal(await prisma.asset.count({ where: { userId: ids.p } }), assetsBefore);
    assert.deepEqual(await balanceSheet('p'), sheetBefore);

    assert.equal((await api('p').post('/api/expenses', { periodId: state.periodId, category: 'VIVIENDA', description: 'Renta', amount: 9000 })).status, 201);
    const expensesCount = await prisma.expense.count({ where: { userId: ids.p } });
    const view = (await api('p').get(`/api/academy/budget?${new URLSearchParams(state.month)}`)).body.view;
    const housing = view.rows.find((r) => r.category === 'VIVIENDA');
    assert.equal(housing.actual, 9000);
    assert.equal(housing.difference, -1500);
    assert.equal(housing.status, 'OVER');
    assert.equal(view.rows.find((r) => r.category === 'DEUDAS').actual, 3000);
    assert.equal(view.diagnosisPending, 13000);
    assert.equal(view.unbudgeted.length, 0);
    assert.equal(await prisma.expense.count({ where: { userId: ids.p } }), expensesCount);

    const saving = await api('p').post('/api/academy/budget/actuals', { ...state.month, category: 'AHORRO', amount: 2000, description: 'Ahorro del mes' });
    assert.equal(saving.status, 201);
    assert.equal(saving.body.view.savingsActual, 2000);
    assert.equal((await balanceSheet('p')).assets, sheetBefore.assets + 2000);

    const other = await api('q').get(`/api/academy/budget?${new URLSearchParams(state.month)}`);
    assert.equal(other.status, 403);
    assert.equal(await prisma.budget.count({ where: { userId: ids.q } }), 0);
    await complete('p', 7);
  });

  test('M8 usa liquidez y gastos reales; la meta no crea patrimonio; la aportación confirmada sí, una vez', async () => {
    const initial = await api('p').get('/api/academy/emergency');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.essential.source, 'MOVEMENTS');
    assert.equal(initial.body.essential.amount, 12000);
    assert.equal(initial.body.liquid.amount, 38000);
    const sheet = await balanceSheet('p');
    const plan = await api('p').put('/api/academy/emergency', { targetMonths: 3, monthlyContribution: 2000, declaredEssential: 18000, useDeclared: true });
    assert.equal(plan.status, 200);
    const r = plan.body.result;
    assert.equal(r.target, 54000);
    assert.equal(r.gap, 16000);
    assert.equal(r.monthsToGoal, 8);
    assert.deepEqual(await balanceSheet('p'), sheet);
    const contributed = await api('p').post('/api/academy/emergency/contributions', { amount: 2000, description: 'Aportación al fondo' });
    assert.equal(contributed.status, 201);
    assert.equal(contributed.body.liquid.amount, 40000);
    assert.equal((await balanceSheet('p')).assets, sheet.assets + 2000);
    await complete('p', 8);
  });

  test('M9 opera sobre Debt real: pasivo en patrimonio, plan no reduce saldo, pago confirmado es gasto real', async () => {
    const before = await balanceSheet('p');
    const created = await api('p').post('/api/academy/obligations', { name: 'Tarjeta bancaria', type: 'TARJETA_CREDITO', balance: 28000, annualRate: 42, payment: 3500, fees: 150 });
    assert.equal(created.status, 201);
    state.balanceId = created.body.id;
    const list = (await api('p').get('/api/academy/obligations')).body;
    const card = list.items.find((d) => d.balanceId === state.balanceId);
    assert.equal(card.monthlyInterest, 980);
    assert.equal(card.monthlyCost, 1130);
    assert.equal(card.principalContribution, 2370);
    assert.equal(list.totals.payments, 3500);
    assert.equal(list.items.some((d) => d.name === 'Deudas por desglosar (diagnóstico)'), false);
    assert.ok(Math.abs(list.totals.paymentToIncome - (3500 / 30000) * 100) < 1e-9);
    const unknown = await api('p').post('/api/academy/obligations', { name: 'Préstamo familiar', type: 'PRESTAMO_FAMILIAR', balance: 5000, annualRate: '', payment: 500, fees: 0 });
    assert.equal(unknown.status, 201);
    const unknownView = (await api('p').get('/api/academy/obligations')).body.items.find((d) => d.balanceId === unknown.body.id);
    assert.equal(unknownView.annualRate, null);
    assert.equal(unknownView.rateKnown, false);
    const after = await balanceSheet('p');
    assert.equal(after.liabilities, before.liabilities + 33000);
    assert.equal(after.netWorth, before.netWorth - 33000);
    assert.equal(Number((await prisma.debtBalance.findUnique({ where: { id: state.balanceId } })).balance), 28000);
    const expenses = await prisma.expense.count({ where: { userId: ids.p, category: 'DEUDAS' } });
    const paid = await api('p').post(`/api/academy/obligations/${state.balanceId}/payments`, { amount: 3500, newBalance: 25870 });
    assert.equal(paid.status, 201);
    assert.equal(await prisma.expense.count({ where: { userId: ids.p, category: 'DEUDAS' } }), expenses);
    assert.equal(await prisma.expense.count({ where: { userId: ids.p, source: 'M1_DEBT_PAYMENT' } }), 0);
    assert.equal(Number((await prisma.debtBalance.findUnique({ where: { id: state.balanceId } })).balance), 25870);
    assert.equal((await api('q').put(`/api/academy/obligations/${state.balanceId}`, { name: 'x', balance: 1, payment: 1 })).status, 403);
    assert.equal((await api('full', ids.q).put(`/api/academy/obligations/${state.balanceId}`, { name: 'x', balance: 1, payment: 1 })).status, 404);
    await complete('p', 9);
  });

  test('M10 estima sin tocar la realidad; eliminar un análisis no elimina el activo', async () => {
    const sheet = await balanceSheet('p');
    const item = await api('p').post('/api/academy/tax-items', { name: 'Negocio principal', type: 'NEGOCIO', period: 'MENSUAL', capital: 100000, grossProfit: 12000, commissions: 800, otherCosts: 200, taxRate: 25, sourceAssetId: state.assetId });
    assert.equal(item.status, 201);
    assert.equal(item.body.result.net, 8250);
    assert.equal(item.body.result.netReturn, 8.25);
    const foreign = await prisma.asset.create({ data: { userId: ids.q, name: 'Ajeno', categoryId: (await prisma.assetCategory.findUnique({ where: { code: 'NEGOCIOS' } })).id } });
    assert.equal((await api('p').post('/api/academy/tax-items', { name: 'X', type: 'NEGOCIO', period: 'ANUAL', capital: 1, grossProfit: 1, commissions: 0, otherCosts: 0, taxRate: 10, sourceAssetId: foreign.id })).status, 400);
    assert.equal((await api('p').post('/api/academy/tax-items', { name: 'X', type: 'NEGOCIO', period: 'ANUAL', capital: 1, grossProfit: 1, commissions: 0, otherCosts: 0, taxRate: 101 })).status, 400);
    await api('p').post('/api/academy/tax-items', { name: 'Inversión', type: 'INVERSION_FINANCIERA', period: 'TRIMESTRAL', capital: 50000, grossProfit: 4500, commissions: 250, otherCosts: 100, taxRate: 20 });
    const list = (await api('p').get('/api/academy/tax-items')).body;
    assert.equal(list.consolidated.mixedPeriods, true);
    assert.deepEqual(await balanceSheet('p'), sheet);
    assert.equal((await api('p').del(`/api/academy/tax-items/${item.body.id}`)).status, 204);
    assert.equal(await prisma.asset.count({ where: { id: state.assetId } }), 1);
    await complete('p', 10);
  });

  test('M11 guarda escenarios en la base y nunca modifica patrimonio ni cartera', async () => {
    const sheet = await balanceSheet('p');
    const positions = await prisma.assetPosition.findMany({ where: { periodId: state.periodId }, orderBy: { id: 'asc' } });
    const created = await api('p').post('/api/academy/scenarios', { name: 'Ahorro vivienda', type: 'AHORRO', capital: 100000, years: 10, inflationRate: 4, nominalRate: 6, sourceAssetId: state.assetId });
    assert.equal(created.status, 201);
    assert.ok(Math.abs(created.body.result.nominalFuture - 100000 * 1.06 ** 10) < 1e-6);
    assert.equal(await prisma.inflationScenario.count({ where: { userId: ids.p } }), 1);
    const edited = await api('p').put(`/api/academy/scenarios/${created.body.id}`, { name: 'Ahorro vivienda', type: 'AHORRO', capital: 100000, years: 0, inflationRate: 4, nominalRate: 6 });
    assert.equal(edited.body.result.realFuture, 100000);
    assert.equal((await api('p').post('/api/academy/scenarios', { name: 'x', type: 'OTRO', capital: 1, years: 1, inflationRate: -100, nominalRate: 0 })).status, 400);
    assert.deepEqual(await balanceSheet('p'), sheet);
    assert.deepEqual(await prisma.assetPosition.findMany({ where: { periodId: state.periodId }, orderBy: { id: 'asc' } }), positions);
    await complete('p', 11);
    assert.equal((await api('p').del(`/api/academy/scenarios/${created.body.id}`)).status, 204);
    assert.equal(await prisma.inflationScenario.count({ where: { userId: ids.p } }), 0);
  });

  test('Corte mensual conserva presupuesto y fondo; mes cerrado no se edita en silencio', async () => {
    const closed = await api('p').post(`/api/periods/${state.periodId}/close`, {});
    assert.equal(closed.status, 201, JSON.stringify(closed.body));
    assert.equal(closed.body.snapshot.budget.view.rows.find((r) => r.category === 'VIVIENDA').actual, 9000);
    assert.equal(closed.body.snapshot.emergency.target, 54000);
    const lines = [['VIVIENDA', 50], ['AHORRO', 50]].map(([category, percent]) => ({ category, percent }));
    assert.equal((await api('p').put('/api/academy/budget', { ...state.month, netIncome: 1, lines })).status, 409);
  });

  test('M12 calcula con el histórico real, guarda snapshot inmutable y genera PDF', async () => {
    const window = annualWindow();
    const userId = ids.h;
    const category = await prisma.assetCategory.findUnique({ where: { code: 'RENTA_VARIABLE' } });
    const asset = await prisma.asset.create({ data: { userId, name: 'Inversiones financieras', categoryId: category.id } });
    const debt = await prisma.debt.create({ data: { userId, name: 'Crédito automotriz', annualRate: 14 } });
    const seedMonth = async ({ year, month }, initial, final, liquidity, debtBalance) => {
      const period = await prisma.financialPeriod.create({ data: { userId, year, month } });
      await prisma.assetPosition.create({ data: { assetId: asset.id, periodId: period.id, initialCapital: initial, finalCapital: final } });
      await prisma.protectionRecord.create({ data: { userId, periodId: period.id, type: 'FONDO_EMERGENCIA', name: 'Fondo', amount: liquidity } });
      await prisma.debtBalance.create({ data: { debtId: debt.id, periodId: period.id, balance: debtBalance, payment: 4800 } });
      return period;
    };
    await seedMonth(shiftMonth(window.start, -1), 300000, 300000, 100000, 140000);
    const last = await seedMonth(window.end, 300000, 325000, 120000, 105000);
    const admin = api('full', userId);
    assert.equal((await admin.put('/api/academy/annual-review/goal', { targetAmount: 500000 })).status, 200);
    assert.equal((await admin.put('/api/academy/annual-review/note', { note: 'Reducir deuda y aumentar liquidez' })).status, 200);
    const live = (await admin.get('/api/academy/annual-review')).body;
    assert.equal(live.window.startDate, window.startDate);
    assert.equal(live.window.endDate, window.endDate);
    assert.equal(live.change.initialNetWorth, 260000);
    assert.equal(live.change.finalNetWorth, 340000);
    assert.equal(live.change.variation, 80000);
    assert.equal(live.goalProgress.progress, 68);
    assert.equal(live.complete, false);
    assert.ok(live.warnings.some((w) => w.code === 'GAPS'));
    assert.equal(live.distribution.reduce((a, d) => a + d.amount, 0), live.change.finalAssets);

    const pdf = await admin.get('/api/academy/annual-review/pdf').buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
    assert.match(pdf.headers['content-disposition'], new RegExp(`${window.startDate}_${window.endDate}`));

    const saved = await admin.post('/api/academy/annual-review/save', {});
    assert.equal(saved.status, 201);
    assert.equal(saved.body.finalNetWorth, 340000);
    assert.equal((await admin.post('/api/academy/annual-review/save', {})).status, 409);
    await prisma.assetPosition.updateMany({ where: { periodId: last.id }, data: { finalCapital: 999999 } });
    assert.notEqual((await admin.get('/api/academy/annual-review')).body.change.finalNetWorth, 340000);
    const history = (await admin.get('/api/academy/annual-review/history')).body;
    assert.equal(history[0].finalNetWorth, 340000);
    assert.equal((await api('q').get(`/api/academy/annual-review/history/${saved.body.id}/pdf`)).status, 403);
    assert.equal((await api('full', ids.q).get(`/api/academy/annual-review/history/${saved.body.id}/pdf`)).status, 404);
  });

  test('Admin VIEW no escribe en M7–M12; el panel muestra el progreso del Bloque 2', async () => {
    const view = api('view', ids.p);
    assert.equal((await view.get('/api/academy/emergency')).status, 200);
    assert.equal((await view.put('/api/academy/emergency', { targetMonths: 6, monthlyContribution: 0 })).status, 403);
    const metrics = (await api('full').get('/api/admin/analytics')).body;
    assert.ok(metrics.block2.reached >= 1);
    assert.equal(metrics.modules.length, 12);
    assert.ok(metrics.block2.annualReviews >= 1);
  });

  test('Paquete de herramientas: dura 30 días y la renovación se suma al vencimiento', async () => {
    const first = await prisma.accessGrant.findFirst({ where: { userId: ids.tool7, accessType: 'TOOL_ONLY' } });
    assert.equal(Math.round((first.expiresAt - first.startsAt) / 86400000), 30);
    await buy('tool7', 'TOOLS_ALL');
    const grants = await prisma.accessGrant.findMany({ where: { userId: ids.tool7, accessType: 'TOOL_ONLY' }, orderBy: { createdAt: 'asc' } });
    assert.equal(grants.length, 2);
    assert.equal(+grants[1].startsAt, +grants[0].expiresAt);
  });
});

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('Ajustes de clientes · desglose del diagnóstico, deudas, presupuesto, aviso y correo', () => {
  let app;
  let prisma;
  let testEmail;
  const uid = `cf${Date.now().toString(36)}`;
  const tokens = {};
  const state = {};

  const api = (who) => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokens[who]}`);
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body) => auth(request(app).post(url)).send(body),
      put: (url, body) => auth(request(app).put(url)).send(body),
      del: (url) => auth(request(app).delete(url)),
    };
  };

  const registerBody = (key, extra = {}) => ({ acceptLegal: true, legalVersion: '2026-10-18', name: `Cliente ${key}`, email: `${key}-${uid}@test.qlc`, password: 'Password123!', ...extra });

  async function register(key) {
    const res = await request(app).post('/api/auth/register').send(registerBody(key));
    assert.equal(res.status, 201);
    tokens[key] = (await completeTwoFactor(app, res.body.challengeToken)).token;
  }

  const query = () => new URLSearchParams(state.month).toString();
  const expenseTotal = async () => (await api('c').get(`/api/periods/${state.periodId}/summary`)).body.summary.cashflow.expenses;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    ({ testEmail } = await import('../src/services/email.service.js'));
    await register('c');
    const checkout = await api('c').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL' });
    await api('c').post(`/api/payments/attempts/${checkout.body.attempt.id}/simulate`, { outcome: 'APPROVED' });
    const email = `admin-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email, name: 'admin', role: 'ADMIN', adminLevel: 'FULL', passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
    tokens.admin = (await completeTwoFactor(app, login.body.challengeToken)).token;
  });

  after(async () => {
    testEmail?.setReady(false);
    await prisma?.$disconnect();
  });

  test('El gasto global del diagnóstico se desglosa: los gastos por categoría no se suman dos veces', async () => {
    const d = await api('c').put('/api/academy/diagnosis', {
      income: 100000, expenses: 60000, debtPayment: 20000, monthlyInvestment: 0,
      cash: 50000, investments: 0, otherAssets: 0, totalDebt: 1000000, emergencyFund: 100000,
      riskTolerance: 'MODERADO', mainGoal: 'CONSTRUIR_PATRIMONIO',
    });
    assert.equal(d.status, 200);
    state.periodId = d.body.periodId;
    const period = await prisma.financialPeriod.findUnique({ where: { id: state.periodId } });
    state.month = { year: period.year, month: period.month };
    assert.equal(await expenseTotal(), 80000);
    const housing = await api('c').post('/api/expenses', { periodId: state.periodId, category: 'VIVIENDA', description: 'Renta', amount: 23500 });
    assert.equal(housing.status, 201);
    await api('c').post('/api/expenses', { periodId: state.periodId, category: 'ALIMENTACION', description: 'Súper', amount: 15000 });
    assert.equal(await expenseTotal(), 80000);
    assert.equal(Number((await prisma.expense.findFirst({ where: { periodId: state.periodId, source: 'M1_EXPENSES' } })).amount), 21500);
    assert.equal((await api('c').put(`/api/expenses/${housing.body.id}`, { periodId: state.periodId, category: 'VIVIENDA', description: 'Renta', amount: 25000 })).status, 200);
    assert.equal(await expenseTotal(), 80000);
    assert.equal((await api('c').del(`/api/expenses/${housing.body.id}`)).status, 204);
    assert.equal(await expenseTotal(), 60000 + 20000);
  });

  test('La deuda total del diagnóstico se desglosa y el pago confirmado reduce el saldo por el abono a capital', async () => {
    assert.equal((await api('c').post('/api/academy/obligations', { name: 'TOYOTA', type: 'TARJETA_CREDITO', balance: 100000, annualRate: 15, payment: 5000, fees: 5000 })).status, 400);
    const toyota = await api('c').post('/api/academy/obligations', { name: 'TOYOTA', type: 'TARJETA_CREDITO', balance: 100000, annualRate: 15, payment: 5000, fees: 0 });
    assert.equal(toyota.status, 201);
    const list = (await api('c').get('/api/academy/obligations')).body;
    assert.equal(list.totals.balance, 1000000);
    assert.equal(list.totals.payments, 20000);
    const pending = list.items.find((i) => i.name === 'Deudas por desglosar (diagnóstico)');
    assert.equal(pending.balance, 900000);
    const car = list.items.find((i) => i.name === 'TOYOTA');
    assert.equal(car.monthlyInterest, 1250);
    assert.equal(car.principalContribution, 3750);

    const paid = await api('c').post(`/api/academy/obligations/${toyota.body.id}/payments`, { amount: 5000 });
    assert.equal(paid.status, 201);
    assert.equal(paid.body.breakdown.interest, 1250);
    assert.equal(paid.body.breakdown.principal, 3750);
    assert.equal(Number((await prisma.debtBalance.findUnique({ where: { id: toyota.body.id } })).balance), 96250);
    assert.equal(Number((await prisma.expense.findFirst({ where: { periodId: state.periodId, source: 'M1_DEBT_PAYMENT' } })).amount), 15000);

    const unknown = await api('c').post(`/api/academy/obligations/${pending.balanceId}/payments`, { amount: 15000 });
    assert.equal(unknown.status, 201);
    assert.equal(Number((await prisma.debtBalance.findUnique({ where: { id: pending.balanceId } })).balance), 885000);

    assert.equal((await api('c').del(`/api/academy/obligations/${toyota.body.id}`)).status, 204);
    assert.equal(Number((await prisma.debtBalance.findUnique({ where: { id: pending.balanceId } })).balance), 981250);
  });

  test('Presupuesto: categoría personalizada, inversión real editable, historial y actualización', async () => {
    const lines = [['VIVIENDA', 30], ['CUSTOM:Mascotas', 5], ['AHORRO', 20], ['INVERSION', 45]].map(([category, percent]) => ({ category, percent }));
    const saved = await api('c').put('/api/academy/budget', { ...state.month, netIncome: 100000, lines });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.lines.map((l) => l.category).join(), 'VIVIENDA,CUSTOM:Mascotas,AHORRO,INVERSION');
    const pet = await api('c').put('/api/academy/budget/actuals', { ...state.month, category: 'CUSTOM:Mascotas', amount: 3000 });
    assert.equal(pet.status, 200);
    assert.equal(pet.body.view.rows.find((r) => r.category === 'CUSTOM:Mascotas').actual, 3000);
    assert.equal(pet.body.actuals.OTROS || 0, 0);
    const lowered = await api('c').put('/api/academy/budget/actuals', { ...state.month, category: 'CUSTOM:Mascotas', amount: 1000 });
    assert.equal(lowered.body.view.rows.find((r) => r.category === 'CUSTOM:Mascotas').actual, 1000);
    const invested = await api('c').put('/api/academy/budget/actuals', { ...state.month, category: 'INVERSION', amount: 18000 });
    assert.equal(invested.status, 200);
    assert.equal(invested.body.view.investmentActual, 18000);
    assert.equal((await api('c').put('/api/academy/budget/actuals', { ...state.month, category: 'INVERSION', amount: 10000 })).body.view.investmentActual, 10000);
    const updated = await api('c').put('/api/academy/budget', { ...state.month, netIncome: 90000, lines });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.netIncome, 90000);
    const history = await api('c').get('/api/academy/budget/history');
    assert.equal(history.status, 200);
    assert.equal(history.body.length, 1);
    assert.equal(history.body[0].netIncome, 90000);
    assert.equal((await api('c').put('/api/academy/budget', { ...state.month, netIncome: 1, lines: [{ category: 'CUSTOM:', percent: 100 }] })).status, 400);
    assert.ok((await api('c').get(`/api/academy/budget?${query()}`)).body.view.diagnosisPending > 0);
  });

  test('Aviso de Copytrading: público, editable por el admin y validado', async () => {
    const initial = await request(app).get('/api/public/notice');
    assert.equal(initial.status, 200);
    assert.equal(typeof initial.body.metrics.returnPct, 'number');
    const body = { active: true, metrics: { returnPct: 21, days: 200, wins: 60, losses: 1, hitRate: 98.3, drawdown: 15 }, bitgetUrl: 'https://www.bitget.com/es/copy-trading/trader/qlc', infoUrl: 'https://www.qlctrade.net/' };
    assert.equal((await api('c').put('/api/admin/login-notice', body)).status, 403);
    const saved = await api('admin').put('/api/admin/login-notice', body);
    assert.equal(saved.status, 200);
    assert.equal((await request(app).get('/api/public/notice')).body.metrics.returnPct, 21);
    assert.equal((await api('admin').put('/api/admin/login-notice', { ...body, metrics: { ...body.metrics, hitRate: 120 } })).status, 400);
  });

  test('Registro con código por correo cuando Gmail está conectado; sin Gmail no se exige', async () => {
    const off = await request(app).post('/api/auth/register/email-code').send({ email: `nomail-${uid}@test.qlc` });
    assert.equal(off.body.required, false);
    testEmail.setReady(true);
    const email = `mail-${uid}@test.qlc`;
    const sent = await request(app).post('/api/auth/register/email-code').send({ email });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.required, true);
    const code = testEmail.outbox.find((m) => m.to === email && m.template === 'verifyEmail').data.code;
    const missing = await request(app).post('/api/auth/register').send(registerBody('mail'));
    assert.equal(missing.status, 400);
    const wrong = await request(app).post('/api/auth/register').send(registerBody('mail', { emailToken: sent.body.emailToken, emailCode: code === '000000' ? '111111' : '000000' }));
    assert.equal(wrong.status, 400);
    const other = await request(app).post('/api/auth/register').send(registerBody('other', { emailToken: sent.body.emailToken, emailCode: code }));
    assert.equal(other.status, 400);
    const ok = await request(app).post('/api/auth/register').send(registerBody('mail', { emailToken: sent.body.emailToken, emailCode: code }));
    assert.equal(ok.status, 201);
    assert.equal((await request(app).post('/api/auth/register/email-code').send({ email })).status, 409);
    testEmail.setReady(false);
  });
});

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor, nextCode } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;
const round = (n) => Math.round(n * 100) / 100;

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
    const lines = [['VIVIENDA', 30], ['CUSTOM:Mascotas', 5], ['AHORRO', 20], ['INVERSION', 25]].map(([category, percent]) => ({ category, percent }));
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
    assert.equal(saved.body.view.debtPercent, 20);
    assert.equal(saved.body.view.percentTotal, 100);
    assert.equal((await api('c').put('/api/academy/budget', { ...state.month, netIncome: 100000, lines: lines.map((l) => (l.category === 'INVERSION' ? { ...l, percent: 45 } : l)) })).status, 400);
    const updated = await api('c').put('/api/academy/budget', { ...state.month, netIncome: 100000, lines: lines.map((l) => (l.category === 'VIVIENDA' ? { ...l, percent: 25 } : l.category === 'CUSTOM:Mascotas' ? { ...l, percent: 10 } : l)) });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.lines.find((l) => l.category === 'CUSTOM:Mascotas').percent, 10);
    const history = await api('c').get('/api/academy/budget/history');
    assert.equal(history.status, 200);
    assert.equal(history.body.length, 1);
    assert.equal(history.body[0].netIncome, 100000);
    assert.equal((await api('c').put('/api/academy/budget', { ...state.month, netIncome: 1, lines: [{ category: 'CUSTOM:', percent: 100 }] })).status, 400);
    assert.ok((await api('c').get(`/api/academy/budget?${query()}`)).body.view.diagnosisPending > 0);
  });

  test('Flujo disponible se calcula solo y confirmar los gastos reales quita el estimado del diagnóstico', async () => {
    const lines = [['VIVIENDA', 30], ['FLUJO_DISPONIBLE', 20], ['AHORRO', 20], ['INVERSION', 10]].map(([category, percent]) => ({ category, percent }));
    const saved = await api('c').put('/api/academy/budget', { ...state.month, netIncome: 100000, lines });
    assert.equal(saved.status, 200);
    const v = saved.body.view;
    const free = v.rows.find((r) => r.category === 'FLUJO_DISPONIBLE');
    assert.equal(free.actual, 100000 - v.rows.filter((r) => r.kind !== 'FREE').reduce((a, r) => a + r.actual, 0) - v.debtPayments);
    assert.equal(v.tableBalance, free.actual);
    assert.equal((await api('c').put('/api/academy/budget/actuals', { ...state.month, category: 'FLUJO_DISPONIBLE', amount: 1 })).status, 400);
    assert.ok(v.diagnosisPending > 0);
    const confirmed = await api('c').post('/api/academy/budget/confirm-real', state.month);
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.view.diagnosisPending, 0);
    assert.equal(await prisma.expense.count({ where: { periodId: state.periodId, source: 'M1_EXPENSES' } }), 0);
  });

  test('Las citas son por chat interno con duraciones de 20, 40 o 60 minutos', async () => {
    const scheduledAt = new Date(Date.now() + 2 * 86400000).toISOString();
    assert.equal((await api('c').post('/api/appointments', { reason: 'Presupuesto', scheduledAt, durationMin: 45 })).status, 400);
    assert.equal((await api('c').post('/api/appointments', { reason: 'Presupuesto', scheduledAt, durationMin: 40, channel: 'VIDEOLLAMADA' })).status, 400);
    const ok = await api('c').post('/api/appointments', { reason: 'Presupuesto', scheduledAt, durationMin: 40, channel: 'CHAT_INTERNO' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.channel, 'CHAT_INTERNO');
  });

  test('Rentabilidad mensual automática: se suma al capital final y se puede corregir', async () => {
    const created = await api('c').post('/api/portfolio/positions', { periodId: state.periodId, categoryCode: 'BIENES_RAICES', name: 'Casa en renta', initialCapital: 1000000, finalCapital: 1000000, incomeType: 'AMOUNT', incomeValue: 12000, incomeDay: 1 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const product = async () => (await api('c').get(`/api/periods/${state.periodId}/summary`)).body.summary.portfolio.products.find((p) => p.positionId === created.body.id);
    let p = await product();
    assert.equal(p.final, 1012000);
    assert.equal(p.result, 12000);
    assert.equal(p.roi, 1.2);
    assert.equal(p.incomeAmount, 12000);
    const { applyDueIncome } = await import('../src/services/productIncome.service.js');
    await applyDueIncome();
    assert.equal((await product()).final, 1012000);
    const day = new Date((await product()).incomeDate);
    const skipped = await api('c').put(`/api/portfolio/positions/${created.body.id}/income`, { amount: 0, date: day.toISOString() });
    assert.equal(skipped.status, 200);
    p = await product();
    assert.equal(p.final, 1000000);
    assert.equal((await api('c').put(`/api/portfolio/positions/${created.body.id}/income`, { amount: 11000, date: '2001-01-01T12:00:00Z' })).status, 400);
    assert.equal((await api('c').post('/api/portfolio/positions', { periodId: state.periodId, categoryCode: 'RENTA_FIJA', name: 'CETES', initialCapital: 1, finalCapital: 1, incomeType: 'PERCENT' })).status, 400);
  });

  test('Se pueden crear periodos anteriores para probar el informe anual', async () => {
    const past = { year: state.month.year - 1, month: state.month.month };
    const created = await api('c').post('/api/periods', past);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const positions = await prisma.assetPosition.count({ where: { periodId: created.body.id } });
    assert.ok(positions > 0);
    assert.equal((await api('c').post('/api/periods', past)).status, 409);
  });

  test('Un cambio en el capital final de un mes anterior se arrastra al capital inicial del mes siguiente', async () => {
    const past = await prisma.financialPeriod.findFirst({ where: { user: { email: `c-${uid}@test.qlc` }, year: state.month.year - 1, month: state.month.month } });
    const pastPos = await prisma.assetPosition.findFirst({ where: { periodId: past.id, asset: { name: 'Casa en renta' } }, include: { asset: { include: { category: true } } } });
    const nowPos = () => prisma.assetPosition.findFirst({ where: { periodId: state.periodId, assetId: pastPos.assetId } });
    const before = await nowPos();
    const res = await api('c').put(`/api/portfolio/positions/${pastPos.id}`, { periodId: past.id, categoryCode: pastPos.asset.category.code, name: 'Casa en renta', initialCapital: Number(pastPos.initialCapital), finalCapital: Number(pastPos.finalCapital) + 5000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const pastAfter = await prisma.assetPosition.findUnique({ where: { id: pastPos.id } });
    const delta = Number(pastAfter.finalCapital) - Number(pastPos.finalCapital);
    assert.ok(delta >= 5000);
    const after = await nowPos();
    assert.equal(Number(after.initialCapital), Number(before.initialCapital) + delta);
    assert.equal(Number(after.finalCapital) - Number(after.initialCapital), Number(before.finalCapital) - Number(before.initialCapital));
  });

  test('Editar el producto controla la rentabilidad: manual del mes o automática, y el arrastre del mes anterior se puede sumar', async () => {
    const body = (extra) => ({ periodId: state.periodId, categoryCode: 'RENTA_FIJA', name: 'Bono prueba', initialCapital: 100000, finalCapital: 100000, ...extra });
    const created = await api('c').post('/api/portfolio/positions', body({ incomeType: 'MANUAL', incomeValue: 2500, incomeDay: 1 }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(Number(created.body.finalCapital), 102500);
    assert.equal(Number(created.body.incomeAmount), 2500);
    const auto = await api('c').put(`/api/portfolio/positions/${created.body.id}`, body({ incomeType: 'AMOUNT', incomeValue: 8000, incomeDay: 1 }));
    assert.equal(auto.status, 200, JSON.stringify(auto.body));
    assert.equal(Number(auto.body.finalCapital), 108000);
    const again = await api('c').put(`/api/portfolio/positions/${created.body.id}`, body({ incomeType: 'AMOUNT', incomeValue: 5000, incomeDay: 1 }));
    assert.equal(Number(again.body.finalCapital), 105000);
    const manual = await api('c').put(`/api/portfolio/positions/${created.body.id}`, body({ incomeType: 'MANUAL', finalCapital: 101000 }));
    assert.equal(Number(manual.body.finalCapital), 101000);
    assert.equal(manual.body.asset.incomeType, null);
    assert.equal((await api('c').put(`/api/portfolio/positions/${created.body.id}`, body({ incomeType: 'MANUAL', incomeValue: 100 }))).status, 400);

    const casa = await prisma.assetPosition.findFirst({ where: { periodId: state.periodId, asset: { name: 'Casa en renta' } } });
    await prisma.assetPosition.update({ where: { id: casa.id }, data: { initialCapital: Number(casa.initialCapital) - 7000, finalCapital: Number(casa.finalCapital) - 7000 } });
    const gaps = await api('c').get(`/api/portfolio/carry?periodId=${state.periodId}`);
    const gap = gaps.body.find((g) => g.positionId === casa.id);
    assert.equal(gap.gap, 7000);
    const applied = await api('c').post(`/api/portfolio/positions/${casa.id}/carry`, {});
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(Number(applied.body.initialCapital), Number(casa.initialCapital));
    assert.ok(!(await api('c').get(`/api/portfolio/carry?periodId=${state.periodId}`)).body.some((g) => g.positionId === casa.id));
    assert.equal((await api('c').post(`/api/portfolio/positions/${casa.id}/carry`, {})).status, 400);
  });

  test('Un producto nuevo no descuadra la conciliación y la rentabilidad se puede mover a gastos y deshacer', async () => {
    const summary = async () => (await api('c').get(`/api/periods/${state.periodId}/summary`)).body.summary;
    const before = await summary();
    const diff0 = before.reconciliation.difference;
    const created = await api('c').post('/api/portfolio/positions', { periodId: state.periodId, categoryCode: 'NEGOCIOS', name: 'Lavandería', initialCapital: 150000, finalCapital: 150000, incomeType: 'MANUAL' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal((await summary()).reconciliation.difference, diff0);
    const withIncome = await api('c').put(`/api/portfolio/positions/${created.body.id}`, { periodId: state.periodId, categoryCode: 'NEGOCIOS', name: 'Lavandería', initialCapital: 150000, finalCapital: 150000, incomeType: 'MANUAL', incomeValue: 20000, incomeDay: 1 });
    assert.equal(Number(withIncome.body.finalCapital), 170000);
    let s1 = await summary();
    assert.equal(s1.reconciliation.difference, diff0);
    const expenses0 = s1.cashflow.expenses;
    const patrimony0 = s1.patrimony.final;

    assert.equal((await api('c').post(`/api/portfolio/positions/${created.body.id}/spend`, { amount: 25000, category: 'VIAJES' })).status, 400);
    const spent = await api('c').post(`/api/portfolio/positions/${created.body.id}/spend`, { amount: 5000, category: 'VIAJES', description: 'Viaje' });
    assert.equal(spent.status, 201, JSON.stringify(spent.body));
    s1 = await summary();
    assert.equal(s1.reconciliation.difference, diff0);
    assert.equal(s1.patrimony.final, round(patrimony0 - 5000));
    assert.ok(s1.cashflow.expenses >= expenses0);
    const pos = await prisma.assetPosition.findUnique({ where: { id: created.body.id } });
    assert.equal(Number(pos.initialCapital), 145000);
    assert.equal(Number(pos.finalCapital), 165000);
    const uses = await api('c').get(`/api/portfolio/spend?periodId=${state.periodId}`);
    assert.equal(uses.body.length, 1);
    assert.equal((await api('c').put(`/api/expenses/${spent.body.id}`, { periodId: state.periodId, category: 'VIAJES', description: 'x', amount: 1 })).status, 400);
    const carry = await api('c').get(`/api/portfolio/carry?periodId=${state.periodId}`);
    assert.ok(!carry.body.some((g) => g.positionId === created.body.id));

    assert.equal((await api('c').del(`/api/portfolio/spend/${spent.body.id}`)).status, 204);
    s1 = await summary();
    assert.equal(s1.patrimony.final, patrimony0);
    assert.equal(s1.reconciliation.difference, diff0);
    assert.equal(Number((await prisma.assetPosition.findUnique({ where: { id: created.body.id } })).initialCapital), 150000);

    const again = await api('c').post(`/api/portfolio/positions/${created.body.id}/spend`, { amount: 3000, category: 'OTROS' });
    const movement = await prisma.patrimonialMovement.findFirst({ where: { assetId: pos.assetId, type: 'DEDUCCION' } });
    assert.equal((await api('c').del(`/api/patrimonial-movements/${movement.id}`)).status, 204);
    assert.equal(await prisma.expense.count({ where: { id: again.body.id } }), 0);
    assert.equal(Number((await prisma.assetPosition.findUnique({ where: { id: created.body.id } })).initialCapital), 150000);
  });

  test('El cliente puede reiniciar su perfil y conserva su cuenta y su acceso', async () => {
    await register('reset');
    const checkout = await api('reset').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL' });
    await api('reset').post(`/api/payments/attempts/${checkout.body.attempt.id}/simulate`, { outcome: 'APPROVED' });
    await api('reset').put('/api/academy/diagnosis', {
      income: 50000, expenses: 30000, debtPayment: 0, monthlyInvestment: 0, cash: 10000, investments: 0, otherAssets: 0, totalDebt: 0, emergencyFund: 0,
      riskTolerance: 'MODERADO', mainGoal: 'CONSTRUIR_PATRIMONIO',
    });
    const user = await prisma.user.findUnique({ where: { email: `reset-${uid}@test.qlc` } });
    assert.ok(await prisma.financialPeriod.count({ where: { userId: user.id } }));
    assert.equal((await api('reset').post('/api/auth/reset-profile', { confirm: 'no' })).status, 400);
    assert.equal((await api('admin').post('/api/auth/reset-profile', { confirm: 'REINICIAR' })).status, 403);
    const done = await api('reset').post('/api/auth/reset-profile', { confirm: 'REINICIAR' });
    assert.equal(done.status, 200);
    assert.equal(await prisma.financialPeriod.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.moduleSubmission.count({ where: { userId: user.id } }), 0);
    assert.ok(await prisma.accessGrant.count({ where: { userId: user.id } }));
    assert.equal((await api('reset').get('/api/auth/me')).status, 200);
  });

  test('Un pago de deuda no se confirma dos veces y se puede deshacer o eliminar', async () => {
    const debt = await api('c').post('/api/academy/obligations', { name: 'Préstamo prueba', type: 'PRESTAMO_PERSONAL', balance: 10000, annualRate: 12, payment: 1100, fees: 0 });
    assert.equal(debt.status, 201);
    const id = debt.body.id;
    const expensesBefore = await prisma.expense.count({ where: { periodId: state.periodId, source: 'M9_PAYMENT' } });
    assert.equal((await api('c').post(`/api/academy/obligations/${id}/payments`, { amount: 1100 })).status, 201);
    assert.equal(Number((await prisma.debtBalance.findUnique({ where: { id } })).balance), 9000);
    assert.equal((await api('c').post(`/api/academy/obligations/${id}/payments`, { amount: 1100 })).status, 409);
    assert.equal(await prisma.expense.count({ where: { periodId: state.periodId, source: 'M9_PAYMENT' } }), expensesBefore + 1);
    const undone = await api('c').del(`/api/academy/obligations/${id}/payments`);
    assert.equal(undone.status, 200);
    assert.equal(Number((await prisma.debtBalance.findUnique({ where: { id } })).balance), 10000);
    assert.equal(await prisma.expense.count({ where: { periodId: state.periodId, source: 'M9_PAYMENT' } }), expensesBefore);
    await api('c').post(`/api/academy/obligations/${id}/payments`, { amount: 1100 });
    const paid = await prisma.debtBalance.findUnique({ where: { id } });
    assert.equal((await api('c').del(`/api/expenses/${paid.paymentExpenseId}`)).status, 204);
    const released = await prisma.debtBalance.findUnique({ where: { id } });
    assert.equal(Number(released.balance), 10000);
    assert.equal(released.paidAt, null);
    await api('c').del(`/api/academy/obligations/${id}`);
  });

  test('La inversión real sin asignar se ve en el resumen y se asigna a un producto de Mi cartera', async () => {
    const summary = async () => (await api('c').get(`/api/periods/${state.periodId}/summary`)).body.summary;
    let s = await summary();
    assert.ok(s.patrimony.unassignedContributions > 0);
    const pending = s.patrimony.unassignedContributions;
    const product = s.portfolio.products.find((p) => p.name === 'Casa en renta');
    const movement = s.patrimony.unassignedMovements[0];
    const assigned = await api('c').post(`/api/portfolio/positions/${product.positionId}/assign`, { movementId: movement.id });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    s = await summary();
    assert.equal(s.patrimony.unassignedContributions, round(pending - movement.amount));
    assert.equal(s.portfolio.products.find((p) => p.positionId === product.positionId).initial, product.initial + movement.amount);
    assert.equal(s.reconciliation.reconciled, (await summary()).reconciliation.reconciled);
  });

  test('La rentabilidad automática respeta el plazo elegido', async () => {
    const { withinTerm } = await import('../src/services/productIncome.service.js');
    const asset = { incomeTerm: 3, incomeStart: new Date(Date.UTC(2026, 9, 1, 12)) };
    assert.equal(withinTerm(asset, { year: 2026, month: 10 }), true);
    assert.equal(withinTerm(asset, { year: 2026, month: 12 }), true);
    assert.equal(withinTerm(asset, { year: 2027, month: 1 }), false);
    assert.equal(withinTerm({ incomeTerm: null }, { year: 2030, month: 1 }), true);
  });

  test('Seguros con aseguradora y póliza cuentan en la protección; la póliza en archivo es opcional', async () => {
    const base = { periodId: state.periodId, type: 'SEGURO_AUTO', name: 'Seguro del auto', amount: 350000 };
    assert.equal((await api('c').post('/api/protection', base)).status, 400);
    const created = await api('c').post('/api/protection', { ...base, insurer: 'Aseguradora QLC', policyNumber: 'POL-123', claimsNumber: '800 000 0000' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.policyNumber, 'POL-123');
    const summary = (await api('c').get(`/api/periods/${state.periodId}/summary`)).body.summary;
    assert.ok(summary.protection.insuranceTypes.includes('SEGURO_AUTO'));
    const upload = await api('c').post(`/api/protection/${created.body.id}/policy`).attach('file', Buffer.from('%PDF-1.4 prueba'), { filename: 'poliza.pdf', contentType: 'application/pdf' });
    assert.equal(upload.status, 503);
    assert.equal((await api('c').get(`/api/protection/${created.body.id}/policy`)).status, 404);
  });

  test('El cliente puede eliminar su cuenta con confirmación y código de verificación', async () => {
    const res = await request(app).post('/api/auth/register').send(registerBody('bye'));
    const { token, secret } = await completeTwoFactor(app, res.body.challengeToken);
    tokens.bye = token;
    assert.equal((await api('bye').post('/api/auth/delete-account', { confirm: 'no', code: nextCode(secret, 0) })).status, 400);
    assert.equal((await api('bye').post('/api/auth/delete-account', { confirm: 'ELIMINAR', code: '000000' })).status, 401);
    assert.equal((await api('admin').post('/api/auth/delete-account', { confirm: 'ELIMINAR', code: '123456' })).status, 403);
    const done = await api('bye').post('/api/auth/delete-account', { confirm: 'ELIMINAR', code: nextCode(secret, 1) });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(await prisma.user.count({ where: { email: `bye-${uid}@test.qlc` } }), 0);
    assert.equal((await api('bye').get('/api/auth/me')).status, 401);
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

  test('Los datos capturados antes del desglose se concilian una sola vez', async () => {
    await register('old');
    const checkout = await api('old').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL' });
    await api('old').post(`/api/payments/attempts/${checkout.body.attempt.id}/simulate`, { outcome: 'APPROVED' });
    const d = await api('old').put('/api/academy/diagnosis', {
      income: 100000, expenses: 60000, debtPayment: 20000, monthlyInvestment: 0,
      cash: 50000, investments: 0, otherAssets: 0, totalDebt: 1000000, emergencyFund: 100000,
      riskTolerance: 'MODERADO', mainGoal: 'CONSTRUIR_PATRIMONIO',
    });
    const user = await prisma.user.findUnique({ where: { email: `old-${uid}@test.qlc` } });
    const scope = { userId: user.id, periodId: d.body.periodId };
    await prisma.expense.createMany({ data: [['VIVIENDA', 23500], ['ALIMENTACION', 15000], ['ENTRETENIMIENTO', 10000], ['TRANSPORTE', 5000]].map(([category, amount]) => ({ ...scope, category, amount, description: 'Previo' })) });
    const debt = await prisma.debt.create({ data: { userId: user.id, name: 'TOYOTA', annualRate: 15 } });
    await prisma.debtBalance.create({ data: { debtId: debt.id, periodId: d.body.periodId, balance: 100000, payment: 5000 } });
    const summary = async () => (await api('old').get(`/api/periods/${d.body.periodId}/summary`)).body.summary;
    assert.equal((await summary()).cashflow.expenses, 133500);
    assert.equal((await summary()).debts.totalBalance, 1100000);
    await prisma.publicSection.deleteMany({ where: { key: 'fix:diagnosis-breakdown-v1' } });
    const { reconcileDiagnosisBreakdown } = await import('../src/services/moduleData.service.js');
    assert.ok((await reconcileDiagnosisBreakdown()) >= 1);
    assert.equal((await summary()).cashflow.expenses, 80000);
    assert.equal((await summary()).debts.totalBalance, 1000000);
    assert.equal(await reconcileDiagnosisBreakdown(), 0);
  });

  test('Registro con código por correo cuando Gmail está conectado; sin Gmail no se exige', async () => {
    testEmail.required = true;
    const blocked = await request(app).post('/api/auth/register/email-code').send({ email: `nomail-${uid}@test.qlc` });
    assert.equal(blocked.status, 503);
    assert.equal((await request(app).post('/api/auth/register').send(registerBody('nomail'))).status, 400);
    testEmail.required = false;
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

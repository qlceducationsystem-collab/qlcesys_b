import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('Diagnóstico y productos: objetivo personalizado, lectura desde el M2 y negocio como inversión', () => {
  let app;
  let prisma;
  let token;
  const uid = `df${Date.now().toString(36)}`;
  const auth = (r) => r.set('Authorization', `Bearer ${token}`);
  const get = (url) => auth(request(app).get(url));
  const put = (url, body) => auth(request(app).put(url)).send(body);
  const post = (url, body) => auth(request(app).post(url)).send(body);
  const diagnosis = { income: 100000, expenses: 60000, debtPayment: 0, monthlyInvestment: 0, cash: 300000, investments: 1000000, otherAssets: 0, totalDebt: 0, emergencyFund: 0, riskTolerance: 'MODERADO' };
  const pending = async () => {
    const s = (await get('/api/dashboard')).body.summary;
    return s.portfolio.products.find((p) => p.source === 'M1_INVESTMENTS')?.final || 0;
  };

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, legalVersion: '2026-10-18', name: 'Cliente diagnóstico', email: `${uid}@test.qlc`, password: 'Password123!' });
    token = (await completeTwoFactor(app, res.body.challengeToken)).token;
    const checkout = await post('/api/payments/checkout', { offerCode: 'TOOLS_ALL' });
    await post(`/api/payments/attempts/${checkout.body.attempt.id}/simulate`, { outcome: 'APPROVED' });
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  test('El objetivo financiero puede ser personalizado', async () => {
    assert.equal((await put('/api/academy/diagnosis', { ...diagnosis, mainGoal: 'OTRO' })).status, 400);
    const saved = await put('/api/academy/diagnosis', { ...diagnosis, mainGoal: 'OTRO', mainGoalCustom: 'Comprar mi casa' });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const profile = (await get('/api/academy/diagnosis')).body.profile;
    assert.equal(profile.mainGoal, 'OTRO');
    assert.equal(profile.mainGoalCustom, 'Comprar mi casa');
  });

  test('La lectura del portafolio aparece hasta que hay productos registrados en el M2', async () => {
    const before = (await get('/api/dashboard')).body.allocation;
    assert.equal(before.registered, false);
    assert.equal(before.reading, null);
    assert.equal(before.total, 0);
    const added = await post('/api/academy/products', { name: 'CETES', productType: 'RENTA_FIJA', capital: 200000, horizon: 'CORTO', liquidityLevel: 'ALTA', perceivedRisk: 'BAJO' });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    const afterAdd = (await get('/api/dashboard')).body.allocation;
    assert.equal(afterAdd.registered, true);
    assert.ok(afterAdd.reading);
    const fixed = afterAdd.shares.find((x) => x.key === 'RENTA_FIJA');
    assert.deepEqual(fixed.items, [{ name: 'CETES', amount: 200000 }]);
  });

  test('Un negocio registrado en el M2 se descuenta de las inversiones por desglosar', async () => {
    assert.equal(await pending(), 800000);
    const negocio = await post('/api/academy/products', { name: 'Lavandería', productType: 'NEGOCIO', capital: 300000, horizon: 'LARGO', liquidityLevel: 'BAJA', perceivedRisk: 'MEDIO' });
    assert.equal(negocio.status, 201, JSON.stringify(negocio.body));
    assert.equal(await pending(), 500000);
    const edited = await put(`/api/academy/products/${negocio.body.id}`, { name: 'Lavandería', productType: 'NEGOCIO', capital: 500000, horizon: 'LARGO', liquidityLevel: 'BAJA', perceivedRisk: 'MEDIO' });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(await pending(), 300000);
    const s = (await get('/api/dashboard')).body.summary;
    assert.equal(s.portfolio.products.some((p) => p.source === 'M1_OTHER_ASSETS'), false);
  });

  test('Una inversión sin asignar se puede repartir entre varios productos con montos personalizados', async () => {
    const s0 = (await get('/api/dashboard')).body.summary;
    const period = (await get('/api/dashboard')).body.period;
    const user = await prisma.user.findUnique({ where: { email: `${uid}@test.qlc` } });
    const movement = await prisma.patrimonialMovement.create({ data: { userId: user.id, periodId: period.id, type: 'APORTACION', amount: 15000, date: new Date(), description: 'Aportación registrada desde el presupuesto (M7)' } });
    const cetes = s0.portfolio.products.find((p) => p.name === 'CETES');
    const lav = s0.portfolio.products.find((p) => p.name === 'Lavandería');
    assert.equal((await post(`/api/portfolio/positions/${cetes.positionId}/assign`, { movementId: movement.id, amount: 20000 })).status, 400);
    assert.equal((await post(`/api/portfolio/positions/${cetes.positionId}/assign`, { movementId: movement.id, amount: 5000 })).status, 200);
    let s1 = (await get('/api/dashboard')).body.summary;
    assert.equal(s1.patrimony.unassignedContributions, 10000);
    assert.equal(s1.portfolio.products.find((p) => p.name === 'CETES').initial, cetes.initial + 5000);
    assert.equal((await post(`/api/portfolio/positions/${lav.positionId}/assign`, { movementId: movement.id, amount: 10000 })).status, 200);
    s1 = (await get('/api/dashboard')).body.summary;
    assert.equal(s1.patrimony.unassignedContributions, 0);
    assert.equal(s1.portfolio.products.find((p) => p.name === 'Lavandería').initial, lav.initial + 10000);
    assert.equal(s1.reconciliation.difference, s0.reconciliation.difference);
  });

  test('La Masterclass del módulo solo se entrega con el acceso completo', async () => {
    assert.equal((await get('/api/academy/modules/1/masterclass')).status, 403);
    const user = await prisma.user.findUnique({ where: { email: `${uid}@test.qlc` } });
    const offer = await prisma.productOffer.findUnique({ where: { code: 'FULL_ANNUAL' } });
    await prisma.accessGrant.create({ data: { userId: user.id, offerId: offer.id, accessType: 'FULL_ANNUAL', startsAt: new Date(), expiresAt: new Date(Date.now() + 86400000) } });
    const mod = await get('/api/academy/modules/1');
    assert.equal(mod.body.masterclass.available, true);
    const mc = await get('/api/academy/modules/1/masterclass');
    assert.equal(mc.status, 200, JSON.stringify(mc.body));
    assert.ok(mc.body.blocks.length > 50);
    assert.ok(JSON.stringify(mc.body.blocks).includes('MASTERCLASS'));
    assert.equal((await request(app).get('/api/academy/modules/1/masterclass')).status, 401);
    await prisma.appSetting.upsert({ where: { key: 'masterclass' }, create: { key: 'masterclass', value: { includedWithFull: false } }, update: { value: { includedWithFull: false } } });
    assert.equal((await get('/api/academy/modules/1/masterclass')).status, 403);
    assert.equal((await get('/api/academy/modules/1')).body.masterclass.available, false);
    const mcOffer = await prisma.productOffer.findUnique({ where: { code: 'MASTERCLASS' } });
    assert.equal(mcOffer.active, false);
    await prisma.accessGrant.create({ data: { userId: user.id, offerId: mcOffer.id, accessType: 'MASTERCLASS', startsAt: new Date(), expiresAt: new Date(Date.now() + 86400000) } });
    assert.equal((await get('/api/academy/modules/1/masterclass')).status, 200);
    await prisma.appSetting.delete({ where: { key: 'masterclass' } });
  });

  test('El M3 no se completa hasta registrar la rentabilidad de cada inversión (puede ser 0)', async () => {
    assert.equal((await put('/api/academy/modules/1/progress', { status: 'COMPLETED' })).status, 200);
    assert.equal((await put('/api/academy/modules/2/progress', { status: 'COMPLETED' })).status, 200);
    const blocked = await put('/api/academy/modules/3/progress', { status: 'COMPLETED' });
    assert.equal(blocked.status, 400, JSON.stringify(blocked.body));
    assert.match(blocked.body.error, /rentabilidad/);
    const products = (await get('/api/dashboard')).body.summary.portfolio.products.filter((p) => !p.source);
    for (const p of products) {
      const res = await put(`/api/portfolio/positions/${p.positionId}`, { periodId: (await get('/api/dashboard')).body.period.id, categoryCode: p.categoryCode, name: p.name, initialCapital: p.initial, finalCapital: p.initial, incomeType: 'MANUAL', incomeValue: 0, incomeDay: 1 });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    const ok = await put('/api/academy/modules/3/progress', { status: 'COMPLETED' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  test('El presupuesto guardado se descarga en PDF y un periodo se reinicia sin afectar a los demás', async () => {
    const period = (await get('/api/dashboard')).body.period;
    assert.equal((await get(`/api/academy/budget/pdf?year=${period.year}&month=${period.month}`)).status, 404);
    const lines = [['VIVIENDA', 25], ['ALIMENTACION', 12], ['TRANSPORTE', 8], ['ENTRETENIMIENTO', 7], ['AHORRO', 25], ['INVERSION', 23]].map(([category, percent]) => ({ category, percent }));
    assert.equal((await put('/api/academy/budget', { year: period.year, month: period.month, netIncome: 50000, lines })).status, 200);
    const pdf = await get(`/api/academy/budget/pdf?year=${period.year}&month=${period.month}`).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');

    const past = await post('/api/periods', { year: period.year - 1, month: period.month });
    assert.equal(past.status, 201, JSON.stringify(past.body));
    const pastPositions = await prisma.assetPosition.count({ where: { periodId: past.body.id } });
    assert.equal((await post(`/api/periods/${period.id}/reset`, { confirm: 'no' })).status, 400);
    const reset = await post(`/api/periods/${period.id}/reset`, { confirm: 'REINICIAR' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(reset.body.year, period.year);
    assert.equal(reset.body.month, period.month);
    assert.equal(await prisma.income.count({ where: { periodId: reset.body.id } }), 0);
    assert.equal(await prisma.budget.count({ where: { userId: reset.body.userId, year: period.year, month: period.month } }), 0);
    assert.equal(await prisma.assetPosition.count({ where: { periodId: past.body.id } }), pastPositions);
  });

  test('En modo manual se puede registrar una pérdida del mes, que se resta del capital final', async () => {
    const period = (await get('/api/dashboard')).body.period;
    const created = await post('/api/portfolio/positions', { periodId: period.id, categoryCode: 'ACTIVOS_DIGITALES', name: 'BTC', initialCapital: 2000000, finalCapital: 2000000, incomeType: 'MANUAL' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const body = (extra) => ({ periodId: period.id, categoryCode: 'ACTIVOS_DIGITALES', name: 'BTC', initialCapital: 2000000, finalCapital: 2000000, ...extra });
    const loss = await put(`/api/portfolio/positions/${created.body.id}`, body({ incomeType: 'MANUAL', incomeValue: -100000, incomeDay: 2 }));
    assert.equal(loss.status, 200, JSON.stringify(loss.body));
    assert.equal(Number(loss.body.finalCapital), 1900000);
    assert.equal(Number(loss.body.incomeAmount), -100000);
    const product = (await get('/api/dashboard')).body.summary.portfolio.products.find((p) => p.positionId === created.body.id);
    assert.equal(product.result, -100000);
    assert.equal((await put(`/api/portfolio/positions/${created.body.id}`, body({ incomeType: 'MANUAL', incomeValue: -3000000, incomeDay: 2 }))).status, 400);
    assert.equal((await put(`/api/portfolio/positions/${created.body.id}`, body({ incomeType: 'AMOUNT', incomeValue: -5000, incomeDay: 2 }))).status, 400);
  });

  test('La rentabilidad de una inversión se puede enviar al fondo de emergencia o a la meta, y se deshace al eliminar la aportación', async () => {
    const period = (await get('/api/dashboard')).body.period;
    const btc = (await get('/api/dashboard')).body.summary.portfolio.products.find((p) => p.name === 'BTC');
    const body = { periodId: period.id, categoryCode: 'ACTIVOS_DIGITALES', name: 'BTC', initialCapital: 2000000, finalCapital: 2000000, incomeType: 'MANUAL', incomeValue: 30000, incomeDay: 2 };
    assert.equal((await put(`/api/portfolio/positions/${btc.positionId}`, body)).status, 200);
    const before = (await get('/api/dashboard')).body.summary;
    assert.equal((await post(`/api/portfolio/positions/${btc.positionId}/use-income`, { origin: 'MONTH', kind: 'SAVE', destination: 'META_PATRIMONIAL', amount: 1000 })).status, 400);
    const saved = await post(`/api/portfolio/positions/${btc.positionId}/use-income`, { origin: 'MONTH', kind: 'SAVE', destination: 'FONDO_EMERGENCIA', amount: 10000 });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    const after = (await get('/api/dashboard')).body.summary;
    assert.equal(after.reconciliation.difference, before.reconciliation.difference);
    assert.equal(after.balanceSheet.netWorth, before.balanceSheet.netWorth);
    assert.equal(after.protection.total, before.protection.total + 10000);
    assert.equal((await post(`/api/portfolio/positions/${btc.positionId}/use-income`, { origin: 'MONTH', kind: 'SAVE', destination: 'FONDO_EMERGENCIA', amount: 25000 })).status, 400);
    const goal = (await get('/api/dashboard')).body.goal;
    assert.ok('goal' in goal);
    await prisma.emergencyFundPlan.upsert({ where: { userId: saved.body.userId }, create: { userId: saved.body.userId, targetMonths: 3, monthlyContribution: 0 }, update: {} });
    const row = await prisma.savingContribution.findUnique({ where: { id: saved.body.contributionId } });
    assert.ok(row);
    const { deleteContribution } = await import('../src/services/emergency.service.js');
    await deleteContribution({ subjectId: saved.body.userId }, row.id);
    const reverted = (await get('/api/dashboard')).body.summary;
    assert.equal(reverted.protection.total, before.protection.total);
    assert.equal(reverted.portfolio.products.find((p) => p.name === 'BTC').final, before.portfolio.products.find((p) => p.name === 'BTC').final);
    assert.equal(await prisma.incomeUse.count({ where: { id: saved.body.id } }), 0);
  });
});

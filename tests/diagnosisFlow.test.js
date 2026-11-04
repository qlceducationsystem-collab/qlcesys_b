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
    assert.equal(mod.body.hasMasterclass, true);
    const mc = await get('/api/academy/modules/1/masterclass');
    assert.equal(mc.status, 200, JSON.stringify(mc.body));
    assert.match(mc.body.html, /MASTERCLASS/);
    assert.equal((await request(app).get('/api/academy/modules/1/masterclass')).status, 401);
  });
});

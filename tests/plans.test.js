import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('Estructura comercial: herramientas, masterclass por módulo, consultas, orientación y retención', () => {
  let app;
  let prisma;
  let testEmail;
  let runRetention;
  const uid = `pl${Date.now().toString(36)}`;
  const tokens = {};
  const ids = {};

  const api = (who) => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokens[who]}`);
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body = {}) => auth(request(app).post(url)).send(body),
      patch: (url, body = {}) => auth(request(app).patch(url)).send(body),
      put: (url, body = {}) => auth(request(app).put(url)).send(body),
    };
  };

  async function register(key) {
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, legalVersion: '2026-10-18', name: `Cliente ${key}`, email: `${key}-${uid}@test.qlc`, password: 'Password123!' });
    assert.equal(res.status, 201);
    tokens[key] = (await completeTwoFactor(app, res.body.challengeToken)).token;
    ids[key] = (await prisma.user.findUnique({ where: { email: `${key}-${uid}@test.qlc` } })).id;
  }

  const buy = async (who, body) => {
    const checkout = await api(who).post('/api/payments/checkout', body);
    assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
    const paid = await api(who).post(`/api/payments/attempts/${checkout.body.attempt.id}/simulate`, { outcome: 'APPROVED' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    return checkout.body.attempt;
  };

  const catalog = async (who) => {
    const body = (await api(who).get('/api/academy/masterclass')).body;
    return Array.isArray(body) ? body : body.items;
  };

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    ({ testEmail } = await import('../src/services/email.service.js'));
    ({ runRetention } = await import('../src/services/subscriber.service.js'));
    await prisma.appSetting.deleteMany({ where: { key: { in: ['notifications', 'google-oauth'] } } });
    const email = `admin-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email, name: 'Admin planes', role: 'ADMIN', adminLevel: 'FULL', passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
    tokens.admin = (await completeTwoFactor(app, login.body.challengeToken)).token;
    for (const k of ['tools', 'mc', 'diamond', 'gone']) await register(k);
  });

  test('Los precios de la estructura comercial están publicados', async () => {
    const { offers } = (await api('tools').get('/api/payments/access')).body;
    const byCode = Object.fromEntries(offers.map((o) => [o.code, o]));
    const { OFFERS } = await import('../prisma/data/offers.js');
    const seed = Object.fromEntries(OFFERS.map((o) => [o.code, o]));
    assert.equal(Number(seed.TOOLS_ALL.price), 5);
    assert.equal(seed.TOOLS_ALL.accessDays, 30);
    assert.equal(Number(seed.FULL_ANNUAL.price), 60);
    assert.equal(byCode.DIAMOND_ANNUAL?.price, 100);
    assert.equal(byCode.DIAMOND_ANNUAL?.sessions, 6);
    assert.equal(byCode.MASTERCLASS_M1?.price, 5);
    assert.equal(byCode.CONSULTA?.price, 3);
    assert.equal(byCode.ORIENTACION?.price, 10);
  });

  test('Solo herramientas no abre la Masterclass y solo Masterclass no abre herramientas', async () => {
    await buy('tools', { offerCode: 'TOOLS_ALL' });
    assert.equal((await api('tools').get('/api/academy/modules/1/masterclass')).status, 403);
    await buy('mc', { offerCode: 'MASTERCLASS_M1' });
    assert.equal((await api('mc').get('/api/academy/modules/1/masterclass')).status, 200);
    assert.equal((await api('mc').get('/api/dashboard')).status, 403);
  });

  test('Los módulos de Masterclass son secuenciales', async () => {
    assert.equal((await api('mc').post('/api/payments/checkout', { offerCode: 'MASTERCLASS_M2' })).status, 400);
    let items = await catalog('mc');
    assert.equal(items.find((m) => m.number === 1).state, 'AVAILABLE');
    assert.equal(items.find((m) => m.number === 2).state, 'LOCKED_ORDER');
    assert.equal((await api('mc').post('/api/academy/modules/1/masterclass/complete')).status, 200);
    items = await catalog('mc');
    assert.equal(items.find((m) => m.number === 2).state, 'PURCHASABLE');
    await buy('mc', { offerCode: 'MASTERCLASS_M2' });
    assert.equal((await api('mc').get('/api/academy/modules/2/masterclass')).status, 200);
    assert.equal((await api('mc').post('/api/payments/checkout', { offerCode: 'MASTERCLASS_M2' })).status, 409);
  });

  test('En la Masterclass los módulos 4 a 6 son opcionales: tras el 3 se puede pasar al 7', async () => {
    const userId = ids.mc;
    await prisma.masterclassProgress.createMany({ data: [2, 3].map((moduleNumber) => ({ userId, moduleNumber })), skipDuplicates: true });
    const items = await catalog('mc');
    const seven = items.find((m) => m.number === 7);
    assert.equal(seven.state, 'PURCHASABLE');
    assert.equal(seven.previousNumber, 3);
    assert.equal(items.find((m) => m.number === 4).state, 'PURCHASABLE');
    assert.equal(items.find((m) => m.number === 4).optional, true);
    assert.equal(items.find((m) => m.number === 5).state, 'LOCKED_ORDER');
    assert.equal(items.find((m) => m.number === 8).state, 'LOCKED_ORDER');
    await buy('mc', { offerCode: 'MASTERCLASS_M7' });
    assert.equal((await api('mc').get('/api/academy/modules/7/masterclass')).status, 200);
  });

  test('El panel rechaza un Client ID que no es de Google', async () => {
    const res = await api('admin').put('/api/admin/mail-settings', { clientId: 'correo@gmail.com' });
    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.body), /apps\.googleusercontent\.com/);
  });

  test('Sin acceso activo no se venden consultas, porque no hay donde usarlas', async () => {
    assert.equal((await api('gone').post('/api/payments/checkout', { offerCode: 'CONSULTA' })).status, 409);
  });

  test('Las consultas se pagan, se responden y quedan en el historial', async () => {
    assert.equal((await api('tools').post('/api/academy/modules/1/questions', { question: '¿Cómo calculo mi flujo libre?' })).status, 402);
    await buy('tools', { offerCode: 'CONSULTA', quantity: 2 });
    let list = (await api('tools').get('/api/academy/modules/1/questions')).body;
    assert.equal(list.credits.CONSULTA, 2);
    const asked = await api('tools').post('/api/academy/modules/1/questions', { question: '¿Cómo calculo mi flujo libre?' });
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    const pending = (await api('admin').get('/api/admin/questions?status=PENDING')).body;
    const mine = (Array.isArray(pending) ? pending : pending.items).find((q) => q.user?.id === ids.tools);
    assert.ok(mine);
    const answered = await api('admin').patch(`/api/admin/questions/${mine.id}`, { answer: 'Ingresos menos gastos del mes.' });
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    list = (await api('tools').get('/api/academy/modules/1/questions')).body;
    assert.equal(list.credits.CONSULTA, 1);
    assert.equal(list.items[0].answer, 'Ingresos menos gastos del mes.');
  });

  test('Diamond incluye 6 sesiones de orientación de 20 minutos', async () => {
    await buy('diamond', { offerCode: 'DIAMOND_ANNUAL' });
    let credits = (await api('diamond').get('/api/payments/credits')).body;
    assert.equal(credits.ORIENTACION, 6);
    assert.equal((await api('diamond').get('/api/academy/modules/3/masterclass')).status, 200);
    const scheduledAt = new Date(Date.now() + 3 * 86400000).toISOString();
    const appt = await api('diamond').post('/api/appointments', { reason: 'Plan', scheduledAt, durationMin: 40, channel: 'CHAT_INTERNO' });
    assert.equal(appt.status, 201, JSON.stringify(appt.body));
    credits = (await api('diamond').get('/api/payments/credits')).body;
    assert.equal(credits.ORIENTACION, 4);
  });

  test('Sin renovación se avisa a los 10, 20 y 29 días y al día 30 se elimina la cuenta', async () => {
    const value = { enabled: true, since: '2020-01-01T00:00:00.000Z' };
    await prisma.appSetting.upsert({ where: { key: 'retention' }, create: { key: 'retention', value }, update: { value } });
    const offer = await prisma.productOffer.findUnique({ where: { code: 'TOOLS_ALL' } });
    const expired = new Date('2026-01-01T00:00:00Z');
    await prisma.accessGrant.create({ data: { userId: ids.gone, offerId: offer.id, accessType: 'TOOL_ONLY', startsAt: new Date('2025-12-01T00:00:00Z'), expiresAt: expired, source: 'PAGO' } });
    const at = (d) => new Date(expired.getTime() + d * 86400000 + 3600000);
    const only = [ids.gone];
    const paused = await runRetention(at(40), { only });
    assert.equal(paused.paused, true);
    assert.equal(paused.deleted, 0);
    assert.ok(await prisma.user.findUnique({ where: { id: ids.gone } }));
    await prisma.appSetting.update({ where: { key: 'retention' }, data: { value } });
    testEmail.setReady(true);
    const before = testEmail.outbox.length;
    assert.equal((await runRetention(at(5), { only })).notified, 0);
    assert.equal((await runRetention(at(10), { only })).notified, 1);
    assert.equal((await runRetention(at(11), { only })).notified, 0);
    assert.equal((await runRetention(at(20), { only })).notified, 1);
    assert.equal((await runRetention(at(29), { only })).notified, 1);
    const mails = testEmail.outbox.slice(before).filter((m) => m.template === 'retention' && m.to === `gone-${uid}@test.qlc`);
    assert.deepEqual(mails.map((m) => m.data.left), [20, 10, 1]);
    assert.equal((await runRetention(at(30), { only })).deleted, 1);
    assert.equal(await prisma.user.findUnique({ where: { id: ids.gone } }), null);
    assert.equal((await runRetention(at(400), { only: [ids.diamond] })).deleted, 0);
    testEmail.setReady(false);
  });
});

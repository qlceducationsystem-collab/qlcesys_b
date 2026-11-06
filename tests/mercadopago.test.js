import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('Mercado Pago configurado desde el panel', () => {
  let app;
  let prisma;
  let realFetch;
  const uid = `mp${Date.now().toString(36)}`;
  const tokens = {};
  const ids = {};
  const TOKEN = 'APP_USR-token-super-privado';
  const SECRET = 'clave-webhook-privada';
  const payments = new Map();
  const preferences = [];

  const api = (who) => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokens[who]}`);
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body = {}) => auth(request(app).post(url)).send(body),
      put: (url, body = {}) => auth(request(app).put(url)).send(body),
    };
  };

  const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

  const stubFetch = async (url, opt = {}) => {
    const u = String(url);
    assert.equal(opt.headers?.Authorization, `Bearer ${TOKEN}`);
    if (u.endsWith('/users/me')) return json({ id: 1, nickname: 'QLC', site_id: 'MLM', tags: [] });
    if (u.endsWith('/checkout/preferences')) {
      const body = JSON.parse(opt.body);
      preferences.push(body);
      return json({ id: `pref-${uid}-${preferences.length}`, init_point: 'https://mp.test/pagar', sandbox_init_point: 'https://mp.test/sandbox' });
    }
    const found = /\/v1\/payments\/([^/?]+)$/.exec(u);
    if (found) return json(payments.get(found[1]));
    if (u.includes('/v1/payments/search')) {
      const ref = new URL(u).searchParams.get('external_reference');
      return json({ results: [...payments.values()].filter((p) => p.external_reference === ref) });
    }
    throw new Error(`fetch no esperado ${u}`);
  };

  const signature = (dataId, requestId, ts = '1700000000') => `ts=${ts},v1=${crypto.createHmac('sha256', SECRET).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')}`;

  const webhook = (paymentId, tag) => request(app)
    .post(`/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`)
    .set('x-signature', signature(paymentId, `${tag}-${uid}`))
    .set('x-request-id', `${tag}-${uid}`)
    .send({ type: 'payment', data: { id: paymentId } });

  async function register(key) {
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, legalVersion: '2026-10-18', name: `Cliente ${key}`, email: `${key}-${uid}@test.qlc`, password: 'Password123!' });
    assert.equal(res.status, 201);
    tokens[key] = (await completeTwoFactor(app, res.body.challengeToken)).token;
    ids[key] = (await prisma.user.findUnique({ where: { email: `${key}-${uid}@test.qlc` } })).id;
  }

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    await prisma.appSetting.deleteMany({ where: { key: 'mercadopago' } });
    const { resetPaymentSettingsCache } = await import('../src/services/payments/paymentSettings.service.js');
    resetPaymentSettingsCache();
    const email = `admin-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email, name: 'Admin MP', role: 'ADMIN', adminLevel: 'FULL', passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
    tokens.admin = (await completeTwoFactor(app, login.body.challengeToken)).token;
    const editEmail = `edit-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email: editEmail, name: 'Admin edit', role: 'ADMIN', adminLevel: 'EDIT', passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const editLogin = await request(app).post('/api/auth/login').send({ email: editEmail, password: 'AdminPass123!' });
    tokens.edit = (await completeTwoFactor(app, editLogin.body.challengeToken)).token;
    for (const k of ['ana', 'luis', 'eva', 'old']) await register(k);
    await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { price: 60, currency: 'USDT', active: true } });
    realFetch = global.fetch;
  });

  after(async () => {
    global.fetch = realFetch;
    await prisma.appSetting.deleteMany({ where: { key: 'mercadopago' } });
    const { resetPaymentSettingsCache } = await import('../src/services/payments/paymentSettings.service.js');
    resetPaymentSettingsCache();
  });

  test('Solo el administrador general configura; las credenciales quedan cifradas y no se devuelven', async () => {
    assert.equal((await api('edit').get('/api/admin/payment-settings')).status, 403);
    assert.equal((await api('ana').get('/api/admin/payment-settings')).status, 403);
    const saved = await api('admin').put('/api/admin/payment-settings', { accessToken: TOKEN, webhookSecret: SECRET });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.hasToken, true);
    assert.equal(saved.body.enabled, false);
    assert.ok(!JSON.stringify(saved.body).includes(TOKEN));
    assert.ok(!JSON.stringify(saved.body).includes(SECRET));
    const row = await prisma.appSetting.findUnique({ where: { key: 'mercadopago' } });
    assert.ok(!JSON.stringify(row.value).includes(TOKEN));
    assert.ok(!JSON.stringify(row.value).includes(SECRET));
  });

  test('No se activa sin prueba correcta ni tipo de cambio', async () => {
    const early = await api('admin').put('/api/admin/payment-settings', { enabled: true });
    assert.equal(early.status, 400);
    assert.match(early.body.error, /prueba de conexión/);
    global.fetch = async () => json({ message: 'invalid' }, 401);
    const failed = await api('admin').post('/api/admin/payment-settings/test');
    assert.equal(failed.body.lastTest.ok, false);
    assert.match(failed.body.lastTest.error, /rechazó/);
    global.fetch = stubFetch;
    const ok = await api('admin').post('/api/admin/payment-settings/test');
    assert.equal(ok.body.lastTest.ok, true);
    assert.equal(ok.body.chargeCurrency, 'MXN');
    assert.ok(ok.body.ratesNeeded.includes('USDT'));
    const noRate = await api('admin').put('/api/admin/payment-settings', { enabled: true });
    assert.equal(noRate.status, 400);
    assert.match(noRate.body.error, /tipo de cambio/);
  });

  test('Activado: cobra en la moneda de la cuenta con el tipo de cambio, sin pago simulado', async () => {
    const legacy = await api('old').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL' });
    assert.equal(legacy.body.attempt.provider, 'MOCK');
    ids.legacyAttempt = legacy.body.attempt.id;
    const on = await api('admin').put('/api/admin/payment-settings', { rates: { USD: 18, USDT: 18.5, MXN: 1 }, enabled: true });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body.enabled, true);
    const access = await api('ana').get('/api/payments/access');
    assert.equal(access.body.provider, 'MERCADOPAGO');
    assert.equal(access.body.charge.currency, 'MXN');
    assert.ok(!JSON.stringify(access.body).includes('encrypted'));
    const checkout = await api('ana').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL' });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
    assert.equal(checkout.body.checkout.mode, 'REDIRECT');
    assert.equal(checkout.body.checkout.initPoint, 'https://mp.test/pagar');
    assert.equal(checkout.body.attempt.chargedAmount, 1110);
    assert.equal(checkout.body.attempt.chargedCurrency, 'MXN');
    const pref = preferences.at(-1);
    assert.equal(pref.items[0].unit_price, 1110);
    assert.equal(pref.items[0].currency_id, 'MXN');
    assert.equal(pref.external_reference, checkout.body.attempt.id);
    assert.match(pref.back_urls.success, new RegExp(`pago=${checkout.body.attempt.id}`));
    ids.anaAttempt = checkout.body.attempt.id;
    assert.equal((await api('ana').post(`/api/payments/attempts/${ids.anaAttempt}/simulate`, { outcome: 'APPROVED' })).status, 403);
    assert.equal((await api('old').post(`/api/payments/attempts/${ids.legacyAttempt}/simulate`, { outcome: 'APPROVED' })).status, 403);
    assert.equal((await prisma.accessGrant.count({ where: { userId: ids.old } })), 0);
  });

  test('El webhook exige firma válida y activa el acceso con el pago aprobado', async () => {
    payments.set('1001', { id: 1001, external_reference: ids.anaAttempt, status: 'approved', transaction_amount: 1110, currency_id: 'MXN' });
    const forged = await request(app).post('/api/webhooks/mercadopago?data.id=1001&type=payment').set('x-signature', 'ts=1,v1=abc').set('x-request-id', 'x').send({ type: 'payment', data: { id: '1001' } });
    assert.equal(forged.status, 401);
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id: ids.anaAttempt } })).status, 'PENDING');
    const ok = await webhook('1001', 'req-1');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const attempt = await prisma.paymentAttempt.findUnique({ where: { id: ids.anaAttempt } });
    assert.equal(attempt.status, 'APPROVED');
    assert.equal(attempt.providerPaymentId, '1001');
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.ana, accessType: 'FULL_ANNUAL' } }), 1);
    assert.equal((await webhook('1001', 'req-1')).body.duplicate, true);
    assert.equal((await webhook('1001', 'req-2')).status, 200);
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.ana, accessType: 'FULL_ANNUAL' } }), 1);
  });

  test('Un importe o una moneda distintos no activan el acceso', async () => {
    const checkout = await api('luis').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL' });
    const id = checkout.body.attempt.id;
    payments.set('2001', { id: 2001, external_reference: id, status: 'approved', transaction_amount: 1, currency_id: 'MXN' });
    await webhook('2001', 'req-3');
    payments.set('2002', { id: 2002, external_reference: id, status: 'approved', transaction_amount: 1110, currency_id: 'USD' });
    await webhook('2002', 'req-4');
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id } })).status, 'PENDING');
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.luis } }), 0);
    assert.ok(await prisma.adminEvent.findFirst({ where: { userId: ids.luis, type: 'IMPORTE_NO_COINCIDE' } }));
  });

  test('Tarjeta rechazada y reintento aprobado en la misma compra: el dinero cobrado sí activa el acceso', async () => {
    const checkout = await api('eva').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL' });
    const id = checkout.body.attempt.id;
    payments.set('3001', { id: 3001, external_reference: id, status: 'rejected', transaction_amount: 1110, currency_id: 'MXN' });
    await webhook('3001', 'req-5');
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id } })).status, 'REJECTED');
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.eva } }), 0);
    payments.set('3002', { id: 3002, external_reference: id, status: 'approved', transaction_amount: 1110, currency_id: 'MXN' });
    const synced = await api('eva').post(`/api/payments/attempts/${id}/sync`);
    assert.equal(synced.status, 200, JSON.stringify(synced.body));
    assert.equal(synced.body.attempt.status, 'APPROVED');
    assert.equal(synced.body.access.full?.active, true);
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.eva } }), 1);
    assert.equal((await api('luis').post(`/api/payments/attempts/${id}/sync`)).status, 404);
    await webhook('3002', 'req-6');
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.eva } }), 1);
  });

  test('Un reembolso avisa al administrador y no se confunde con un rechazo', async () => {
    payments.set('1001', { id: 1001, external_reference: ids.anaAttempt, status: 'refunded', transaction_amount: 1110, currency_id: 'MXN' });
    await webhook('1001', 'req-7');
    assert.ok(await prisma.adminEvent.findFirst({ where: { userId: ids.ana, type: 'PAGO_REVERTIDO' } }));
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id: ids.anaAttempt } })).status, 'APPROVED');
  });

  test('Al cambiar el token se desactiva y vuelve el modo de prueba', async () => {
    const changed = await api('admin').put('/api/admin/payment-settings', { accessToken: 'APP_USR-otro-token' });
    assert.equal(changed.body.enabled, false);
    assert.equal(changed.body.lastTest, null);
    assert.equal((await api('ana').get('/api/payments/access')).body.provider, 'MOCK');
  });
});

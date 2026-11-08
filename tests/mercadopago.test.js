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
  const subscriptions = new Map();
  const invoices = new Map();
  let refuseNext = null;
  let ratesDown = true;
  let usdMarket = 17;

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
    if (u.includes('frankfurter') || u.includes('er-api')) return ratesDown ? json({}, 500) : json({ rates: { MXN: usdMarket } });
    if (u.includes('bitso')) return ratesDown ? json({}, 500) : json({ payload: { ask: '17.5' } });
    assert.equal(opt.headers?.Authorization, `Bearer ${TOKEN}`);
    if (u.endsWith('/users/me')) return json({ id: 1, nickname: 'QLC', site_id: 'MLM', tags: [] });
    if (u.endsWith('/checkout/preferences')) {
      const body = JSON.parse(opt.body);
      preferences.push({ body, headers: opt.headers });
      if (refuseNext) return json({ message: refuseNext }, 400);
      return json({ id: `pref-${uid}-${preferences.length}`, init_point: `https://mp.test/pagar/${preferences.length}`, sandbox_init_point: 'https://sandbox.mp.test/pagar' }, 201);
    }
    if (u.endsWith('/preapproval') && opt.method === 'POST') {
      const body = JSON.parse(opt.body);
      const id = `pre${uid}${subscriptions.size + 1}`;
      subscriptions.set(id, { id, status: 'pending', body, init_point: `https://mp.test/suscribir/${id}` });
      return json(subscriptions.get(id), 201);
    }
    const pre = /\/preapproval\/([^/?]+)$/.exec(u);
    if (pre) {
      if (opt.method === 'PUT') subscriptions.get(pre[1]).status = JSON.parse(opt.body).status;
      return json(subscriptions.get(pre[1]));
    }
    const invoice = /\/authorized_payments\/([^/?]+)$/.exec(u);
    if (invoice) return json(invoices.get(invoice[1]));
    const found = /\/v1\/payments\/([^/?]+)$/.exec(u);
    if (found) return json(payments.get(found[1]));
    if (u.includes('/v1/payments/search')) {
      const ref = new URL(u).searchParams.get('external_reference');
      return json({ results: [...payments.values()].filter((p) => p.external_reference === ref) });
    }
    throw new Error(`fetch no esperado ${u}`);
  };

  const signature = (dataId, requestId, ts = '1700000000') => `ts=${ts},v1=${crypto.createHmac('sha256', SECRET).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')}`;

  const subscriptionEvent = (topic, id, tag) => request(app)
    .post(`/api/webhooks/mercadopago?data.id=${id}&type=${topic}`)
    .set('x-signature', signature(id, `${tag}-${uid}`))
    .set('x-request-id', `${tag}-${uid}`)
    .send({ type: topic, data: { id } });

  const webhook = (paymentId, tag) => request(app)
    .post(`/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`)
    .set('x-signature', signature(paymentId, `${tag}-${uid}`))
    .set('x-request-id', `${tag}-${uid}`)
    .send({ type: 'payment', data: { id: paymentId } });

  async function register(key) {
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, residenceCountry: 'MX', legalVersion: '2026-10-18', name: `Cliente ${key}`, email: `${key}-${uid}@test.qlc`, password: 'Password123!' });
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
    for (const k of ['ana', 'luis', 'eva', 'old', 'card', 'subs']) await register(k);
    await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { price: 60, currency: 'USDT', active: true, billingCycle: null } });
    realFetch = global.fetch;
  });

  after(async () => {
    global.fetch = realFetch;
    await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { billingCycle: 'YEARLY' } });
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

  test('El tipo de cambio se actualiza solo, suma 1 peso y frena valores anómalos o fallas', async () => {
    ratesDown = false;
    const { refreshExchangeRates, paymentSettings } = await import('../src/services/payments/paymentSettings.service.js');
    assert.equal((await refreshExchangeRates(stubFetch)).updated, true);
    let settings = await paymentSettings();
    assert.equal(settings.marketRates.USDT, 17.5);
    assert.equal(settings.rates.USDT, 18.5);
    const stamp = settings.ratesUpdatedAt;
    usdMarket = 30;
    const sawBitso = async (url, opt) => (String(url).includes('bitso') ? json({ payload: { ask: '30' } }) : stubFetch(url, opt));
    assert.equal((await refreshExchangeRates(sawBitso)).updated, false);
    settings = await paymentSettings();
    assert.equal(settings.rates.USDT, 18.5);
    assert.match(settings.ratesError, /25%/);
    usdMarket = 17;
    const fallback = async (url) => (String(url).includes('er-api') ? json({ rates: { MXN: 17.2 } }) : json({}, 500));
    assert.equal((await refreshExchangeRates(fallback)).updated, true);
    settings = await paymentSettings();
    assert.equal(settings.rates.USDT, 18.2);
    assert.notEqual(settings.ratesUpdatedAt, null);
    assert.ok(stamp);
    assert.equal((await refreshExchangeRates(stubFetch)).updated, true);
    assert.equal((await paymentSettings()).rates.USDT, 18.5);
    assert.equal((await paymentSettings()).ratesError, null);
  });

  test('Activado: cobra en la moneda de la cuenta con el tipo de cambio, sin pago simulado', async () => {
    const legacy = await api('old').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL' });
    assert.equal(legacy.body.attempt.provider, 'MOCK');
    ids.legacyAttempt = legacy.body.attempt.id;
    ratesDown = false;
    const on = await api('admin').put('/api/admin/payment-settings', { rates: { USDT: 1 }, enabled: true });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body.enabled, true);
    const access = await api('ana').get('/api/payments/access');
    assert.equal(access.body.provider, 'MERCADOPAGO');
    assert.equal(access.body.charge.currency, 'MXN');
    assert.ok(!JSON.stringify(access.body).includes('encrypted'));
    const checkout = await api('ana').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL' });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
    assert.equal(checkout.body.checkout.mode, 'REDIRECT');
    assert.match(checkout.body.checkout.initPoint, /^https:\/\/mp\.test\/pagar\//);
    assert.equal(checkout.body.attempt.chargedAmount, 1110);
    assert.equal(checkout.body.attempt.chargedCurrency, 'MXN');
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

  test('Pago único: Checkout Pro cobra el importe del servidor y regresa a la plataforma', async () => {
    const { body } = await api('card').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL', amount: 1 });
    const sent = preferences.at(-1);
    assert.equal(sent.body.items[0].unit_price, 1110);
    assert.equal(sent.body.items[0].currency_id, 'MXN');
    assert.equal(sent.body.external_reference, body.attempt.id);
    assert.match(sent.body.back_urls.success, new RegExp(`/app/acceso\\?pago=${body.attempt.id}$`));
    assert.equal(sent.headers['X-Idempotency-Key'], body.attempt.id);
    assert.equal(body.attempt.status, 'PENDING');
    assert.equal((await api('card').post(`/api/payments/attempts/${body.attempt.id}/card`, { token: 'x', paymentMethodId: 'visa' })).status, 404);
    assert.ok(!JSON.stringify(body).includes(TOKEN));
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.card } }), 0);
  });

  test('Si Mercado Pago rechaza la solicitud se explica el motivo y no queda pago pendiente', async () => {
    refuseNext = 'Unauthorized use of live credentials';
    const res = await api('card').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL' });
    refuseNext = null;
    assert.equal(res.status, 502);
    assert.match(res.body.error, /Detalle para soporte: Mercado Pago 400: Unauthorized use of live credentials/);
    const event = await prisma.adminEvent.findFirst({ where: { userId: ids.card, type: 'PAGO_FALLIDO' }, orderBy: { createdAt: 'desc' } });
    assert.match(event.result, /Unauthorized use of live credentials/);
    assert.equal(await prisma.paymentAttempt.count({ where: { userId: ids.card, status: 'REJECTED' } }), 1);
  });

  test('Suscripción: se contrata en Mercado Pago, abandonarla no bloquea y el cobro activa el acceso', async () => {
    await prisma.productOffer.update({ where: { code: 'TOOLS_ALL' }, data: { price: 5, currency: 'USD', active: true, billingCycle: 'MONTHLY', accessDays: 30 } });
    const buy = () => api('subs').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL' });
    const first = await buy();
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.attempt.billingCycle, 'MONTHLY');
    const abandoned = [...subscriptions.values()].at(-1);
    assert.equal(first.body.checkout.initPoint, abandoned.init_point);
    assert.equal(abandoned.body.status, 'pending');
    assert.equal(abandoned.body.card_token_id, undefined);
    assert.equal(abandoned.body.auto_recurring.frequency, 1);
    assert.equal(abandoned.body.auto_recurring.transaction_amount, 90);
    assert.equal(abandoned.body.payer_email, `subs-${uid}@test.qlc`);
    assert.equal((await api('subs').get('/api/payments/access')).body.subscription.billing, null);

    const failuresBefore = await prisma.adminEvent.count({ where: { userId: ids.subs, type: 'PAGO_FALLIDO' } });
    const second = await buy();
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(abandoned.status, 'canceled');
    assert.equal((await prisma.subscription.findUnique({ where: { providerSubscriptionId: abandoned.id } })).status, 'EXPIRED');
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id: first.body.attempt.id } })).status, 'REJECTED');
    assert.equal(await prisma.adminEvent.count({ where: { userId: ids.subs, type: 'PAGO_FALLIDO' } }), failuresBefore);

    const contracted = [...subscriptions.values()].at(-1);
    contracted.status = 'authorized';
    const synced = await api('subs').post(`/api/payments/attempts/${second.body.attempt.id}/sync`);
    assert.equal(synced.body.attempt.status, 'PENDING');
    assert.equal((await prisma.subscription.findUnique({ where: { providerSubscriptionId: contracted.id } })).status, 'ACTIVE');
    assert.equal((await buy()).status, 409);
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.subs } }), 0);

    invoices.set(`inv${uid}`, { preapproval_id: contracted.id, transaction_amount: 90, currency_id: 'MXN', payment: { id: Date.now(), status: 'approved' } });
    assert.equal((await subscriptionEvent('subscription_authorized_payment', `inv${uid}`, 'sub-1')).status, 200);
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.subs, accessType: 'TOOL_ONLY' } }), 1);
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id: second.body.attempt.id } })).status, 'APPROVED');
    assert.ok(await prisma.adminEvent.findFirst({ where: { userId: ids.subs, type: 'PAGO_EXITOSO' } }));
    await prisma.productOffer.update({ where: { code: 'TOOLS_ALL' }, data: { billingCycle: null } });
  });

  test('El correo de comprador de prueba solo se usa con credenciales de prueba', async () => {
    const { paymentSettings, resetPaymentSettingsCache } = await import('../src/services/payments/paymentSettings.service.js');
    const TEST_BUYER = 'test_user_1@testuser.com';
    assert.equal((await api('admin').put('/api/admin/payment-settings', { testPayerEmail: 'no-es-correo' })).status, 400);
    assert.equal((await api('admin').put('/api/admin/payment-settings', { testPayerEmail: TEST_BUYER })).body.testPayerEmail, TEST_BUYER);
    await register('tester');
    const charged = async () => {
      assert.equal((await api('tester').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL' })).status, 201);
      return preferences.at(-1).body.payer?.email;
    };
    assert.equal(await charged(), `tester-${uid}@test.qlc`);
    const live = await paymentSettings();
    const setTestUser = async (testUser) => {
      await prisma.appSetting.update({ where: { key: 'mercadopago' }, data: { value: { ...live, account: { ...live.account, testUser } } } });
      resetPaymentSettingsCache();
    };
    await setTestUser(true);
    assert.equal(await charged(), TEST_BUYER);
    await api('admin').put('/api/admin/payment-settings', { testPayerEmail: '' });
    assert.equal(await charged(), undefined);
    await setTestUser(false);
    assert.equal((await api('admin').put('/api/admin/payment-settings', { testPayerEmail: '' })).body.testPayerEmail, '');
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

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('Suscripciones ya contratadas en pasarelas anteriores', () => {
  let app;
  let prisma;
  let realFetch;
  let offer;
  const uid = `sub${Date.now().toString(36)}`;
  const tokens = {};
  const ids = {};
  const MP_SECRET = 'clave-webhook-mp';
  const paypalSubs = new Map();
  const preapprovals = new Map();
  const invoices = new Map();
  const payBase = Date.now();
  let signatureOk = true;

  const api = (who) => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokens[who]}`);
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body = {}) => auth(request(app).post(url)).send(body),
    };
  };

  const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

  const stubFetch = async (url, opt = {}) => {
    const u = String(url);
    const method = opt.method || 'GET';
    if (u.endsWith('/v1/oauth2/token')) return json({ access_token: 'pp-token', expires_in: 3600 });
    if (u.endsWith('/v1/notifications/verify-webhook-signature')) return json({ verification_status: signatureOk ? 'SUCCESS' : 'FAILURE' });
    if (u.endsWith('/v1/currency-exchanges')) return json({ data: [] });
    const cancel = /\/v1\/billing\/subscriptions\/([^/]+)\/cancel$/.exec(u);
    if (cancel) {
      paypalSubs.get(cancel[1]).status = 'CANCELLED';
      return { ok: true, status: 204, json: async () => { throw new Error('vacío'); } };
    }
    const pre = /\/preapproval\/([^/?]+)$/.exec(u);
    if (pre) {
      if (method === 'PUT') preapprovals.get(pre[1]).status = JSON.parse(opt.body).status;
      return json(preapprovals.get(pre[1]));
    }
    const invoice = /\/authorized_payments\/([^/?]+)$/.exec(u);
    if (invoice) return json(invoices.get(invoice[1]));
    throw new Error(`fetch no esperado ${method} ${u}`);
  };

  const paypalEvent = (id, type, resource) => request(app).post('/api/webhooks/paypal')
    .set({ 'paypal-auth-algo': 'a', 'paypal-cert-url': 'b', 'paypal-transmission-id': 'c', 'paypal-transmission-sig': 'd', 'paypal-transmission-time': 'e' })
    .send({ id: `${id}-${uid}`, event_type: type, resource });

  const mpEvent = (topic, dataId, tag) => {
    const ts = '1700000000';
    const requestId = `${tag}-${uid}`;
    const v1 = crypto.createHmac('sha256', MP_SECRET).update(`id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
    return request(app).post(`/api/webhooks/mercadopago?data.id=${dataId}&type=${topic}`).set('x-signature', `ts=${ts},v1=${v1}`).set('x-request-id', requestId).send({ type: topic, data: { id: dataId } });
  };

  async function register(key) {
    const email = `${key}-${uid}@test.qlc`;
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, legalVersion: '2026-11-07', name: `Cliente ${key}`, email, password: 'Password123!' });
    assert.equal(res.status, 201);
    tokens[key] = (await completeTwoFactor(app, res.body.challengeToken)).token;
    ids[key] = (await prisma.user.findUnique({ where: { email } })).id;
  }

  const seedSubscription = async (key, provider, providerSubscriptionId, cycle = 'YEARLY') => {
    const sub = await prisma.subscription.create({ data: { userId: ids[key], offerId: offer.id, provider, providerSubscriptionId, cycle, status: 'ACTIVE', amount: 150, currency: 'USD' } });
    await prisma.paymentAttempt.create({ data: { userId: ids[key], offerId: offer.id, provider, amount: 150, currency: 'USD', chargedAmount: 150, chargedCurrency: 'USD', billingCycle: cycle, subscriptionId: sub.id, status: 'PENDING' } });
    return sub;
  };

  const grants = (key) => prisma.accessGrant.findMany({ where: { userId: ids[key], accessType: 'FULL_ANNUAL' }, orderBy: { createdAt: 'asc' } });

  const resetCaches = async () => {
    (await import('../src/services/payments/paymentSettings.service.js')).resetPaymentSettingsCache();
    (await import('../src/services/payments/paypalSettings.service.js')).resetPaypalCache();
    (await import('../src/services/payments/dlocalSettings.service.js')).resetDlocalCache();
  };

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    const { encryptSecret } = await import('../src/utils/crypto.js');
    await prisma.appSetting.deleteMany({ where: { key: { in: ['mercadopago', 'paypal', 'dlocalgo'] } } });
    const settings = {
      mercadopago: { encryptedToken: encryptSecret('APP_USR-token'), encryptedWebhookSecret: encryptSecret(MP_SECRET) },
      paypal: { mode: 'SANDBOX', clientId: 'cliente', encryptedSecret: encryptSecret('secreto'), webhookId: 'WH-1' },
      dlocalgo: { enabled: true, mode: 'SANDBOX', encryptedApiKey: encryptSecret('k'), encryptedSecret: encryptSecret('s'), currency: 'USD', methods: 'NO_CARDS', rates: { USDT: 1 }, lastTest: { ok: true } },
    };
    for (const [key, value] of Object.entries(settings)) await prisma.appSetting.create({ data: { key, value } });
    await resetCaches();
    const email = `admin-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email, name: 'Admin', role: 'ADMIN', adminLevel: 'FULL', passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    for (const k of ['ana', 'luis', 'mia']) await register(k);
    offer = await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { price: 150, currency: 'USD', active: true, billingCycle: 'YEARLY' } });
    realFetch = global.fetch;
    global.fetch = stubFetch;
  });

  after(async () => {
    global.fetch = realFetch;
    await prisma.appSetting.deleteMany({ where: { key: { in: ['mercadopago', 'paypal', 'dlocalgo'] } } });
    await resetCaches();
  });

  test('PayPal: la renovación extiende un año, no se duplica y exige firma', async () => {
    const subId = `I-${uid}`;
    paypalSubs.set(subId, { id: subId, status: 'ACTIVE' });
    await seedSubscription('ana', 'PAYPAL', subId);
    signatureOk = false;
    assert.equal((await paypalEvent('forged', 'PAYMENT.SALE.COMPLETED', { id: 'SALE-X', billing_agreement_id: subId, amount: { total: '150.00', currency: 'USD' } })).status, 401);
    signatureOk = true;
    assert.equal((await grants('ana')).length, 0);

    const sale = { id: `SALE-1${uid}`, billing_agreement_id: subId, amount: { total: '150.00', currency: 'USD' } };
    assert.equal((await paypalEvent('s1', 'PAYMENT.SALE.COMPLETED', sale)).status, 200);
    assert.equal((await grants('ana')).length, 1);
    assert.equal((await paypalEvent('s1', 'PAYMENT.SALE.COMPLETED', sale)).body.duplicate, true);
    assert.equal((await paypalEvent('s1b', 'PAYMENT.SALE.COMPLETED', sale)).status, 200);
    assert.equal((await grants('ana')).length, 1);

    const firstExpiry = (await grants('ana'))[0].expiresAt;
    assert.equal((await paypalEvent('s2', 'PAYMENT.SALE.COMPLETED', { ...sale, id: `SALE-2${uid}` })).status, 200);
    const renewed = await grants('ana');
    assert.equal(renewed.length, 2);
    assert.equal(renewed[1].expiresAt.getUTCFullYear(), firstExpiry.getUTCFullYear() + 1);

    assert.equal((await paypalEvent('r1', 'PAYMENT.SALE.REFUNDED', { id: 'REF-1', sale_id: `SALE-2${uid}` })).status, 200);
    assert.ok(await prisma.adminEvent.findFirst({ where: { userId: ids.ana, type: 'PAGO_REVERTIDO' } }));
  });

  test('Mientras exista una suscripción activa no se contrata otro plan, y cancelarla detiene el cobro', async () => {
    const blocked = await api('ana').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL', country: 'MX' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /suscripción activa/);
    const status = await api('ana').get('/api/payments/access');
    assert.equal(status.body.subscription.billing.provider, 'PAYPAL');
    const cancelled = await api('ana').post('/api/payments/subscription/cancel');
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(paypalSubs.get(`I-${uid}`).status, 'CANCELLED');
    assert.equal(cancelled.body.billing, null);
    assert.equal(cancelled.body.canResume, false);
    assert.equal((await api('ana').post('/api/payments/subscription/resume')).status, 409);
    assert.equal((await grants('ana')).every((g) => g.active), true);
    assert.equal((await paypalEvent('c1', 'BILLING.SUBSCRIPTION.CANCELLED', { id: `I-${uid}` })).status, 200);
  });

  test('Mercado Pago: la renovación se aplica una vez y un cobro rechazado avisa sin dar acceso', async () => {
    const preId = `pre${uid}`;
    preapprovals.set(preId, { id: preId, status: 'authorized' });
    const sub = await seedSubscription('luis', 'MERCADOPAGO', preId);
    const invoice = (status, id) => ({ preapproval_id: preId, transaction_amount: 150, currency_id: 'USD', payment: { id: payBase + id, status, status_detail: status === 'rejected' ? 'cc_rejected_insufficient_amount' : 'accredited' } });
    invoices.set(`i1${uid}`, invoice('approved', 1));
    assert.equal((await mpEvent('subscription_authorized_payment', `i1${uid}`, 'a1')).status, 200);
    assert.equal((await grants('luis')).length, 1);
    assert.equal((await mpEvent('subscription_authorized_payment', `i1${uid}`, 'a2')).status, 200);
    assert.equal((await grants('luis')).length, 1);
    invoices.set(`i2${uid}`, invoice('rejected', 2));
    assert.equal((await mpEvent('subscription_authorized_payment', `i2${uid}`, 'a3')).status, 200);
    assert.equal((await grants('luis')).length, 1);
    assert.ok(await prisma.adminEvent.findFirst({ where: { userId: ids.luis, type: 'PAGO_FALLIDO' } }));
    preapprovals.get(preId).status = 'cancelled';
    assert.equal((await mpEvent('subscription_preapproval', preId, 'a4')).status, 200);
    assert.equal((await prisma.subscription.findUnique({ where: { id: sub.id } })).status, 'CANCELLED');
    assert.ok(await prisma.adminEvent.findFirst({ where: { userId: ids.luis, type: 'CANCELADA' } }));
  });

  test('Cancelar las suscripciones de un usuario detiene el cobro en la pasarela', async () => {
    const preId = `pre2${uid}`;
    preapprovals.set(preId, { id: preId, status: 'authorized' });
    const sub = await seedSubscription('mia', 'MERCADOPAGO', preId, 'MONTHLY');
    const { cancelUserSubscriptions } = await import('../src/services/subscription.service.js');
    assert.equal(await cancelUserSubscriptions(ids.mia), 1);
    assert.equal(preapprovals.get(preId).status, 'canceled');
    assert.equal((await prisma.subscription.findUnique({ where: { id: sub.id } })).status, 'CANCELLED');
  });
});

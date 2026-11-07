import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('PayPal y suscripciones recurrentes', () => {
  let app;
  let prisma;
  let realFetch;
  const uid = `sub${Date.now().toString(36)}`;
  const tokens = {};
  const ids = {};
  const MP_SECRET = 'clave-webhook-mp';
  const calls = [];
  const paypalSubs = new Map();
  const invoices = new Map();
  const preapprovals = new Map();
  let signatureOk = true;
  let counter = 0;
  const payBase = Date.now();

  const api = (who) => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokens[who]}`);
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body = {}) => auth(request(app).post(url)).send(body),
      put: (url, body = {}) => auth(request(app).put(url)).send(body),
      del: (url, body = {}) => auth(request(app).delete(url)).send(body),
    };
  };

  const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

  const stubFetch = async (url, opt = {}) => {
    const u = String(url);
    const method = opt.method || 'GET';
    const body = opt.body && opt.body !== 'grant_type=client_credentials' ? JSON.parse(opt.body) : null;
    calls.push({ u, method, body });
    if (u.endsWith('/v1/oauth2/token')) return json({ access_token: 'pp-token', expires_in: 3600 });
    if (u.endsWith('/users/me')) return json({ id: 1, nickname: 'QLC', site_id: 'MLM', tags: [] });
    if (u.endsWith('/v1/notifications/verify-webhook-signature')) return json({ verification_status: signatureOk ? 'SUCCESS' : 'FAILURE' });
    if (u.endsWith('/v1/catalogs/products')) return json({ id: 'PROD-QLC' }, 201);
    if (u.endsWith('/v1/billing/plans')) return json({ id: `P-${calls.length}` }, 201);
    if (u.endsWith('/v2/checkout/orders') && method === 'POST') {
      counter += 1;
      return json({ id: `ORDER${uid}${counter}` }, 201);
    }
    const capture = /\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(u);
    if (capture) return json({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: `CAP-${capture[1]}`, status: 'COMPLETED', amount: { value: '150.00', currency_code: 'USD' } }] } }] }, 201);
    if (u.endsWith('/v1/billing/subscriptions') && method === 'POST') {
      counter += 1;
      const id = `I-${uid}${counter}`;
      paypalSubs.set(id, { id, status: 'APPROVAL_PENDING', custom_id: body.custom_id, sales: [] });
      return json({ id, status: 'APPROVAL_PENDING' }, 201);
    }
    const sales = /\/v1\/billing\/subscriptions\/([^/]+)\/transactions/.exec(u);
    if (sales) return json({ transactions: paypalSubs.get(sales[1]).sales });
    const cancel = /\/v1\/billing\/subscriptions\/([^/]+)\/cancel$/.exec(u);
    if (cancel) {
      paypalSubs.get(cancel[1]).status = 'CANCELLED';
      return { ok: true, status: 204, json: async () => { throw new Error('vacío'); } };
    }
    const getSub = /\/v1\/billing\/subscriptions\/([^/?]+)$/.exec(u);
    if (getSub) return json({ ...paypalSubs.get(getSub[1]), billing_info: { next_billing_time: '2030-01-01T00:00:00Z' } });
    if (u.endsWith('/preapproval') && method === 'POST') {
      if (body.card_token_id === 'tok-bad') return json({ message: 'invalid' }, 400);
      counter += 1;
      const id = `pre${uid}${counter}`;
      preapprovals.set(id, { id, status: 'authorized', external_reference: body.external_reference });
      return json({ ...preapprovals.get(id), next_payment_date: '2030-01-01T00:00:00Z' }, 201);
    }
    const pre = /\/preapproval\/([^/?]+)$/.exec(u);
    if (pre) {
      if (method === 'PUT') preapprovals.get(pre[1]).status = body.status;
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
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, legalVersion: '2026-10-18', name: `Cliente ${key}`, email, password: 'Password123!' });
    assert.equal(res.status, 201);
    tokens[key] = (await completeTwoFactor(app, res.body.challengeToken)).token;
    ids[key] = (await prisma.user.findUnique({ where: { email } })).id;
  }

  const grants = (key) => prisma.accessGrant.findMany({ where: { userId: ids[key], accessType: 'FULL_ANNUAL' }, orderBy: { createdAt: 'asc' } });

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    await prisma.appSetting.deleteMany({ where: { key: { in: ['mercadopago', 'paypal'] } } });
    const mp = await import('../src/services/payments/paymentSettings.service.js');
    const pp = await import('../src/services/payments/paypalSettings.service.js');
    mp.resetPaymentSettingsCache();
    pp.resetPaypalCache();
    const email = `admin-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email, name: 'Admin', role: 'ADMIN', adminLevel: 'FULL', passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
    tokens.admin = (await completeTwoFactor(app, login.body.challengeToken)).token;
    for (const k of ['ana', 'luis', 'eva', 'mia', 'once']) await register(k);
    await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { price: 150, currency: 'USD', active: true, billingCycle: 'YEARLY' } });
    await prisma.productOffer.update({ where: { code: 'TOOLS_ALL' }, data: { price: 10, currency: 'USD', active: true, billingCycle: 'MONTHLY' } });
    realFetch = global.fetch;
    global.fetch = stubFetch;
  });

  after(async () => {
    global.fetch = realFetch;
    await prisma.appSetting.deleteMany({ where: { key: { in: ['mercadopago', 'paypal'] } } });
    const mp = await import('../src/services/payments/paymentSettings.service.js');
    const pp = await import('../src/services/payments/paypalSettings.service.js');
    mp.resetPaymentSettingsCache();
    pp.resetPaypalCache();
  });

  test('PayPal se configura desde el panel sin exponer el Secret y exige prueba y Webhook ID', async () => {
    assert.equal((await api('ana').get('/api/admin/paypal-settings')).status, 403);
    const saved = await api('admin').put('/api/admin/paypal-settings', { clientId: 'cliente-pp', clientSecret: 'secreto-pp', mode: 'SANDBOX', currency: 'USD', rates: { USDT: 1, MXN: 0.05 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.ok(!JSON.stringify(saved.body).includes('secreto-pp'));
    const row = await prisma.appSetting.findUnique({ where: { key: 'paypal' } });
    assert.ok(!JSON.stringify(row.value).includes('secreto-pp'));
    const early = await api('admin').put('/api/admin/paypal-settings', { enabled: true });
    assert.equal(early.status, 400);
    assert.match(early.body.error, /Webhook ID/);
    assert.equal((await api('admin').post('/api/admin/paypal-settings/test')).body.lastTest.ok, true);
    const on = await api('admin').put('/api/admin/paypal-settings', { webhookId: 'WH-1', enabled: true });
    assert.equal(on.body.enabled, true, JSON.stringify(on.body));
    const access = await api('ana').get('/api/payments/access');
    assert.deepEqual(access.body.providers, ['PAYPAL']);
    assert.equal(access.body.paypal.currency, 'USD');
    assert.equal(access.body.offers.find((o) => o.code === 'FULL_ANNUAL').billingCycle, 'YEARLY');
    assert.ok(!JSON.stringify(access.body).includes('secreto-pp'));
  });

  test('Pago único con PayPal: el monto lo fija el servidor y se activa al capturar', async () => {
    await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { billingCycle: null } });
    const checkout = await api('once').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL', provider: 'PAYPAL' });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
    assert.equal(checkout.body.checkout.mode, 'PAYPAL');
    assert.equal(checkout.body.checkout.clientId, 'cliente-pp');
    const id = checkout.body.attempt.id;
    const created = await api('once').post(`/api/payments/attempts/${id}/paypal/create`);
    const order = calls.filter((c) => c.u.endsWith('/v2/checkout/orders')).at(-1).body;
    assert.equal(order.purchase_units[0].amount.value, '150.00');
    assert.equal(order.purchase_units[0].custom_id, id);
    assert.equal((await api('once').post(`/api/payments/attempts/${id}/paypal/confirm`, { orderId: 'OTRA' })).status, 400);
    assert.equal((await api('ana').post(`/api/payments/attempts/${id}/paypal/confirm`, { orderId: created.body.orderId })).status, 404);
    const paid = await api('once').post(`/api/payments/attempts/${id}/paypal/confirm`, { orderId: created.body.orderId });
    assert.equal(paid.body.attempt.status, 'APPROVED', JSON.stringify(paid.body));
    assert.equal((await grants('once')).length, 1);
    assert.equal((await paypalEvent('cap1', 'PAYMENT.CAPTURE.COMPLETED', { id: `CAP-${created.body.orderId}`, custom_id: id, amount: { value: '150.00', currency_code: 'USD' } })).status, 200);
    assert.equal((await grants('once')).length, 1);
    await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { billingCycle: 'YEARLY' } });
  });

  test('Suscripción anual con PayPal: se activa con el primer cobro y cada renovación extiende un año, sin duplicar', async () => {
    const checkout = await api('ana').post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL', provider: 'PAYPAL' });
    const id = checkout.body.attempt.id;
    assert.equal(checkout.body.attempt.billingCycle, 'YEARLY');
    const created = await api('ana').post(`/api/payments/attempts/${id}/paypal/create`);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const plan = calls.filter((c) => c.u.endsWith('/v1/billing/plans')).at(-1).body;
    assert.equal(plan.billing_cycles[0].frequency.interval_unit, 'YEAR');
    assert.equal(plan.billing_cycles[0].total_cycles, 0);
    assert.equal(plan.billing_cycles[0].pricing_scheme.fixed_price.value, '150.00');
    const subId = created.body.subscriptionId;
    assert.equal((await api('ana').get('/api/payments/access')).body.subscription.billing, null);

    paypalSubs.get(subId).status = 'ACTIVE';
    const waiting = await api('ana').post(`/api/payments/attempts/${id}/paypal/confirm`, { subscriptionId: subId });
    assert.equal(waiting.body.attempt.status, 'PENDING');
    assert.equal((await grants('ana')).length, 0);

    signatureOk = false;
    assert.equal((await paypalEvent('forged', 'PAYMENT.SALE.COMPLETED', { id: 'SALE-X', billing_agreement_id: subId, amount: { total: '150.00', currency: 'USD' } })).status, 401);
    signatureOk = true;
    assert.equal((await grants('ana')).length, 0);

    const sale = { id: `SALE-1${uid}`, billing_agreement_id: subId, amount: { total: '150.00', currency: 'USD' } };
    assert.equal((await paypalEvent('s1', 'PAYMENT.SALE.COMPLETED', sale)).status, 200);
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id } })).status, 'APPROVED');
    assert.equal((await grants('ana')).length, 1);
    assert.equal((await paypalEvent('s1', 'PAYMENT.SALE.COMPLETED', sale)).body.duplicate, true);
    assert.equal((await paypalEvent('s1b', 'PAYMENT.SALE.COMPLETED', sale)).status, 200);
    assert.equal((await grants('ana')).length, 1);
    paypalSubs.get(subId).sales = [{ id: sale.id, status: 'COMPLETED', amount_with_breakdown: { gross_amount: { value: '150.00', currency_code: 'USD' } } }];
    const again = await api('ana').post(`/api/payments/attempts/${id}/paypal/confirm`, { subscriptionId: subId });
    assert.equal(again.body.attempt.status, 'APPROVED');
    assert.equal((await grants('ana')).length, 1);

    const firstExpiry = (await grants('ana'))[0].expiresAt;
    assert.equal((await paypalEvent('s2', 'PAYMENT.SALE.COMPLETED', { ...sale, id: `SALE-2${uid}` })).status, 200);
    const renewed = await grants('ana');
    assert.equal(renewed.length, 2);
    assert.equal(renewed[1].expiresAt.getUTCFullYear(), firstExpiry.getUTCFullYear() + 1);
    assert.equal(renewed[1].expiresAt.getUTCMonth(), firstExpiry.getUTCMonth());

    const status = await api('ana').get('/api/payments/access');
    assert.equal(status.body.subscription.billing.provider, 'PAYPAL');
    assert.equal(status.body.subscription.billing.cycle, 'YEARLY');
    const second = await api('ana').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL', provider: 'PAYPAL' });
    assert.equal(second.status, 409);

    assert.equal((await paypalEvent('r1', 'PAYMENT.SALE.REFUNDED', { id: 'REF-1', sale_id: `SALE-2${uid}` })).status, 200);
    assert.ok(await prisma.adminEvent.findFirst({ where: { userId: ids.ana, type: 'PAGO_REVERTIDO' } }));

    const cancelled = await api('ana').post('/api/payments/subscription/cancel');
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(paypalSubs.get(subId).status, 'CANCELLED');
    assert.equal(cancelled.body.billing, null);
    assert.equal(cancelled.body.canResume, false);
    assert.equal((await api('ana').post('/api/payments/subscription/resume')).status, 409);
    assert.equal((await grants('ana')).every((g) => g.active), true);
    assert.equal((await paypalEvent('c1', 'BILLING.SUBSCRIPTION.CANCELLED', { id: subId })).status, 200);
  });

  test('Suscripción mensual con tarjeta: queda en proceso hasta el primer cobro y las renovaciones se aplican una vez', async () => {
    const mpOn = await api('admin').put('/api/admin/payment-settings', { accessToken: 'APP_USR-token', publicKey: 'APP_USR-public', webhookSecret: MP_SECRET });
    assert.equal(mpOn.status, 200);
    await api('admin').post('/api/admin/payment-settings/test');
    const on = await api('admin').put('/api/admin/payment-settings', { rates: { USD: 18, USDT: 18 }, enabled: true });
    assert.equal(on.body.enabled, true, JSON.stringify(on.body));
    assert.deepEqual((await api('luis').get('/api/payments/access')).body.providers, ['MERCADOPAGO', 'PAYPAL']);

    const checkout = await api('luis').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL', provider: 'MERCADOPAGO' });
    assert.equal(checkout.body.checkout.mode, 'CARD');
    assert.equal(checkout.body.attempt.chargedAmount, 180);
    const id = checkout.body.attempt.id;
    const paid = await api('luis').post(`/api/payments/attempts/${id}/card`, { token: 'tok-ok', paymentMethodId: 'visa' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.attempt.status, 'PENDING');
    const body = calls.filter((c) => c.u.endsWith('/preapproval')).at(-1).body;
    assert.equal(body.auto_recurring.frequency, 1);
    assert.equal(body.auto_recurring.frequency_type, 'months');
    assert.equal(body.auto_recurring.transaction_amount, 180);
    assert.equal(body.card_token_id, 'tok-ok');
    assert.equal(body.external_reference, id);
    const sub = await prisma.subscription.findFirst({ where: { userId: ids.luis } });
    assert.equal(sub.status, 'ACTIVE');
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.luis } }), 0);

    invoices.set('8001', { preapproval_id: sub.providerSubscriptionId, transaction_amount: 180, currency_id: 'MXN', payment: { id: payBase + 1, status: 'approved' } });
    assert.equal((await mpEvent('subscription_authorized_payment', '8001', 'a1')).status, 200);
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id } })).status, 'APPROVED');
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.luis, accessType: 'TOOL_ONLY' } }), 1);
    assert.equal((await mpEvent('subscription_authorized_payment', '8001', 'a2')).status, 200);
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.luis, accessType: 'TOOL_ONLY' } }), 1);

    invoices.set('8002', { preapproval_id: sub.providerSubscriptionId, transaction_amount: 180, currency_id: 'MXN', payment: { id: payBase + 2, status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' } });
    assert.equal((await mpEvent('subscription_authorized_payment', '8002', 'a3')).status, 200);
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.luis, accessType: 'TOOL_ONLY' } }), 1);
    assert.ok(await prisma.adminEvent.findFirst({ where: { userId: ids.luis, type: 'PAGO_FALLIDO' } }));

    invoices.set('8003', { preapproval_id: sub.providerSubscriptionId, transaction_amount: 180, currency_id: 'MXN', payment: { id: payBase + 3, status: 'approved' } });
    assert.equal((await mpEvent('subscription_authorized_payment', '8003', 'a4')).status, 200);
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.luis, accessType: 'TOOL_ONLY' } }), 2);

    preapprovals.get(sub.providerSubscriptionId).status = 'cancelled';
    assert.equal((await mpEvent('subscription_preapproval', sub.providerSubscriptionId, 'a5')).status, 200);
    assert.equal((await prisma.subscription.findUnique({ where: { id: sub.id } })).status, 'CANCELLED');
    assert.ok(await prisma.adminEvent.findFirst({ where: { userId: ids.luis, type: 'CANCELADA' } }));
  });

  test('Tarjeta inválida en la suscripción: se rechaza sin crear suscripción', async () => {
    const checkout = await api('eva').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL', provider: 'MERCADOPAGO' });
    const res = await api('eva').post(`/api/payments/attempts/${checkout.body.attempt.id}/card`, { token: 'tok-bad', paymentMethodId: 'visa' });
    assert.equal(res.body.attempt.status, 'REJECTED');
    assert.equal(await prisma.subscription.count({ where: { userId: ids.eva } }), 0);
  });

  test('Cancelar las suscripciones de un usuario detiene el cobro en la pasarela', async () => {
    const checkout = await api('mia').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL', provider: 'MERCADOPAGO' });
    await api('mia').post(`/api/payments/attempts/${checkout.body.attempt.id}/card`, { token: 'tok-ok', paymentMethodId: 'visa' });
    const sub = await prisma.subscription.findFirst({ where: { userId: ids.mia } });
    const { cancelUserSubscriptions } = await import('../src/services/subscription.service.js');
    assert.equal(await cancelUserSubscriptions(ids.mia), 1);
    assert.equal(preapprovals.get(sub.providerSubscriptionId).status, 'canceled');
    assert.equal((await prisma.subscription.findUnique({ where: { id: sub.id } })).status, 'CANCELLED');
  });
});

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('dLocal Go', () => {
  let app;
  let prisma;
  let realFetch;
  const uid = `dl${Date.now().toString(36)}`;
  const tokens = {};
  const ids = {};
  const API_KEY = 'dl-api-key-privada';
  const SECRET = 'dl-secret-privada';
  const payments = new Map();
  const created = [];
  const chargebacks = [];
  let counter = 0;
  let methodError = false;

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
    const method = opt.method || 'GET';
    assert.equal(opt.headers?.Authorization, `Bearer ${API_KEY}:${SECRET}`);
    if (u.endsWith('/v1/currency-exchanges')) return json({ data: [] });
    if (u.endsWith('/v1/payments') && method === 'POST') {
      if (methodError) return json({ code: 5010, message: 'Payment Method not available' }, 400);
      const body = JSON.parse(opt.body);
      counter += 1;
      const id = `DP-${uid}-${counter}`;
      created.push(body);
      payments.set(id, { id, amount: body.amount, currency: body.currency, status: 'PENDING', order_id: body.order_id });
      return json({ ...payments.get(id), redirect_url: `https://checkout.test/${id}` });
    }
    const found = /\/v1\/payments\/([^/?]+)$/.exec(u);
    if (found) return json(payments.get(found[1]));
    if (u.includes('/v1/chargebacks')) return json({ data: chargebacks });
    throw new Error(`fetch no esperado ${method} ${u}`);
  };

  const notify = (paymentId, { secret = SECRET } = {}) => {
    const body = JSON.stringify({ payment_id: paymentId });
    const signature = crypto.createHmac('sha256', secret).update(`${API_KEY}${body}`).digest('hex');
    return request(app).post('/api/webhooks/dlocalgo').set('Content-Type', 'application/json').set('Authorization', `V2-HMAC-SHA256, Signature: ${signature}`).send(body);
  };

  async function register(key) {
    const email = `${key}-${uid}@test.qlc`;
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, legalVersion: '2026-11-07', name: `Cliente ${key}`, email, password: 'Password123!' });
    assert.equal(res.status, 201);
    tokens[key] = (await completeTwoFactor(app, res.body.challengeToken)).token;
    ids[key] = (await prisma.user.findUnique({ where: { email } })).id;
  }

  const resetCaches = async () => {
    const dl = await import('../src/services/payments/dlocalSettings.service.js');
    const pp = await import('../src/services/payments/paypalSettings.service.js');
    const mp = await import('../src/services/payments/paymentSettings.service.js');
    dl.resetDlocalCache();
    pp.resetPaypalCache();
    mp.resetPaymentSettingsCache();
  };

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    await prisma.appSetting.deleteMany({ where: { key: { in: ['mercadopago', 'paypal', 'dlocalgo'] } } });
    await resetCaches();
    const email = `admin-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email, name: 'Admin', role: 'ADMIN', adminLevel: 'FULL', passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
    tokens.admin = (await completeTwoFactor(app, login.body.challengeToken)).token;
    for (const k of ['ana', 'luis', 'eva', 'mia']) await register(k);
    await prisma.productOffer.update({ where: { code: 'TOOLS_ALL' }, data: { price: 10, currency: 'USDT', active: true, billingCycle: 'MONTHLY' } });
    realFetch = global.fetch;
    global.fetch = stubFetch;
  });

  after(async () => {
    global.fetch = realFetch;
    await prisma.appSetting.deleteMany({ where: { key: { in: ['mercadopago', 'paypal', 'dlocalgo'] } } });
    await resetCaches();
  });

  test('Se configura desde el panel sin exponer las llaves y exige prueba y tipo de cambio', async () => {
    assert.equal((await api('ana').get('/api/admin/dlocal-settings')).status, 403);
    const saved = await api('admin').put('/api/admin/dlocal-settings', { apiKey: API_KEY, secretKey: SECRET, mode: 'SANDBOX', currency: 'USD' });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.methods, 'NO_CARDS');
    assert.ok(!JSON.stringify(saved.body).includes(SECRET));
    assert.ok(!JSON.stringify(saved.body).includes(API_KEY));
    const row = await prisma.appSetting.findUnique({ where: { key: 'dlocalgo' } });
    assert.ok(!JSON.stringify(row.value).includes(SECRET));
    assert.ok(!JSON.stringify(row.value).includes(API_KEY));
    assert.equal((await api('admin').put('/api/admin/dlocal-settings', { enabled: true })).status, 400);
    assert.equal((await api('admin').post('/api/admin/dlocal-settings/test')).body.lastTest.ok, true);
    const noRate = await api('admin').put('/api/admin/dlocal-settings', { enabled: true });
    assert.equal(noRate.status, 400);
    assert.match(noRate.body.error, /tipo de cambio/);
    const on = await api('admin').put('/api/admin/dlocal-settings', { rates: { USDT: 1, MXN: 0.055 }, enabled: true });
    assert.equal(on.body.enabled, true, JSON.stringify(on.body));
    const access = await api('ana').get('/api/payments/access');
    assert.equal(access.body.provider, 'DLOCALGO');
    assert.ok(access.body.dlocal.countries.includes('CO'));
    assert.ok(!JSON.stringify(access.body).includes(SECRET));
  });

  test('El pago pide país, no crea cobro recurrente y activa el acceso con un aviso firmado', async () => {
    assert.equal((await api('ana').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL' })).status, 400);
    const checkout = await api('ana').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL', country: 'CO' });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
    assert.equal(checkout.body.checkout.mode, 'REDIRECT');
    assert.match(checkout.body.checkout.initPoint, /checkout\.test/);
    assert.equal(checkout.body.attempt.billingCycle, null);
    const id = checkout.body.attempt.id;
    const body = created.at(-1);
    assert.equal(body.amount, 10);
    assert.equal(body.currency, 'USD');
    assert.equal(body.country, 'CO');
    assert.equal(body.order_id, id);
    assert.equal(body.payment_type, 'BANK_TRANSFER,VOUCHER');
    assert.match(body.success_url, new RegExp(`pago=${id}`));
    assert.equal(await prisma.subscription.count({ where: { userId: ids.ana } }), 0);

    const paymentId = (await prisma.paymentAttempt.findUnique({ where: { id } })).providerRef;
    assert.equal((await api('ana').post(`/api/payments/attempts/${id}/simulate`, { outcome: 'APPROVED' })).status, 403);
    assert.equal((await notify(paymentId, { secret: 'otra' })).status, 401);
    const raw = JSON.stringify({ payment_id: paymentId });
    assert.equal((await request(app).post('/api/webhooks/dlocalgo').set('Content-Type', 'application/json').send(raw)).status, 401);

    assert.equal((await notify(paymentId)).status, 200);
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id } })).status, 'PENDING');

    payments.get(paymentId).status = 'PAID';
    assert.equal((await notify(paymentId)).status, 200);
    const paid = await prisma.paymentAttempt.findUnique({ where: { id } });
    assert.equal(paid.status, 'APPROVED');
    assert.equal(paid.providerPaymentId, paymentId);
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.ana, accessType: 'TOOL_ONLY' } }), 1);
    assert.equal((await notify(paymentId)).status, 200);
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.ana, accessType: 'TOOL_ONLY' } }), 1);
  });

  test('Si dLocal Go convierte a la moneda local, el pago aprobado sí activa; regresar sincroniza', async () => {
    const checkout = await api('luis').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL', country: 'CL' });
    const id = checkout.body.attempt.id;
    const paymentId = (await prisma.paymentAttempt.findUnique({ where: { id } })).providerRef;
    payments.set(paymentId, { ...payments.get(paymentId), amount: 9500, currency: 'CLP', status: 'PAID' });
    const synced = await api('luis').post(`/api/payments/attempts/${id}/sync`);
    assert.equal(synced.status, 200, JSON.stringify(synced.body));
    assert.equal(synced.body.attempt.status, 'APPROVED');
    assert.equal(synced.body.access.hasAny, true);
    assert.equal((await api('ana').post(`/api/payments/attempts/${id}/sync`)).status, 404);
  });

  test('Importe distinto en la misma moneda, rechazo y un aviso de otro pago no activan nada', async () => {
    const first = await api('eva').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL', country: 'PE' });
    const firstRef = (await prisma.paymentAttempt.findUnique({ where: { id: first.body.attempt.id } })).providerRef;
    payments.set(firstRef, { ...payments.get(firstRef), amount: 1, status: 'PAID' });
    await notify(firstRef);
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id: first.body.attempt.id } })).status, 'PENDING');
    assert.ok(await prisma.adminEvent.findFirst({ where: { userId: ids.eva, type: 'IMPORTE_NO_COINCIDE' } }));

    const second = await api('eva').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL', country: 'PE' });
    const secondRef = (await prisma.paymentAttempt.findUnique({ where: { id: second.body.attempt.id } })).providerRef;
    payments.get(secondRef).status = 'EXPIRED';
    await notify(secondRef);
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id: second.body.attempt.id } })).status, 'REJECTED');

    const third = await api('eva').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL', country: 'PE' });
    const forged = `DP-${uid}-ajeno`;
    payments.set(forged, { id: forged, amount: 10, currency: 'USD', status: 'PAID', order_id: third.body.attempt.id });
    await notify(forged);
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id: third.body.attempt.id } })).status, 'PENDING');
    assert.equal(await prisma.accessGrant.count({ where: { userId: ids.eva } }), 0);

    methodError = true;
    const unavailable = await api('eva').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL', country: 'NG' });
    methodError = false;
    assert.equal(unavailable.status, 409);
    assert.match(unavailable.body.error, /no está disponible/);
  });

  test('Antes de vencer avisa una sola vez por correo y detecta contracargos', async () => {
    const { sendRenewalReminders } = await import('../src/services/subscriber.service.js');
    const { pollDlocalChargebacks } = await import('../src/services/payments/subscriptionEvents.service.js');
    const grant = await prisma.accessGrant.findFirst({ where: { userId: ids.ana, accessType: 'TOOL_ONLY' } });
    const sent = [];
    const send = async (...args) => {
      sent.push(args);
      return { sent: true };
    };
    await prisma.accessGrant.update({ where: { id: grant.id }, data: { expiresAt: new Date(Date.now() + 20 * 86400000) } });
    assert.equal(await sendRenewalReminders(new Date(), send), 0);
    await prisma.accessGrant.update({ where: { id: grant.id }, data: { expiresAt: new Date(Date.now() + 2 * 86400000) } });
    assert.ok((await sendRenewalReminders(new Date(), send)) >= 1);
    const mine = sent.filter((s) => s[2] === `ana-${uid}@test.qlc`);
    assert.equal(mine.length, 1);
    assert.equal(mine[0][1], 'renewalDue');
    assert.equal(mine[0][3].offerCode, 'TOOLS_ALL');
    const before = sent.length;
    await sendRenewalReminders(new Date(), send);
    assert.equal(sent.filter((s) => s[2] === `ana-${uid}@test.qlc`).length, 1);
    assert.ok(sent.length >= before);

    const attempt = await prisma.paymentAttempt.findFirst({ where: { userId: ids.ana, status: 'APPROVED' } });
    chargebacks.push({ id: `CBK-${uid}`, payment_id: attempt.providerPaymentId, status: 'SUCCESS' });
    await pollDlocalChargebacks();
    await pollDlocalChargebacks();
    assert.equal(await prisma.adminEvent.count({ where: { userId: ids.ana, type: 'PAGO_REVERTIDO' } }), 1);
    assert.equal((await prisma.accessGrant.findUnique({ where: { id: grant.id } })).active, true);
  });

  test('Ya no se puede comprar con Mercado Pago ni con PayPal', async () => {
    const checkout = await api('mia').post('/api/payments/checkout', { offerCode: 'TOOLS_ALL', country: 'MX' });
    assert.equal(checkout.body.attempt.provider, 'DLOCALGO');
    assert.equal((await api('mia').post(`/api/payments/attempts/${checkout.body.attempt.id}/card`, { token: 'x', paymentMethodId: 'visa' })).status, 404);
    assert.equal((await api('mia').post(`/api/payments/attempts/${checkout.body.attempt.id}/paypal/create`)).status, 404);
    assert.equal((await api('admin').get('/api/admin/payment-settings')).status, 404);
    assert.equal((await api('admin').get('/api/admin/paypal-settings')).status, 404);
  });
});

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';
import { codeAt, currentStep } from '../src/utils/totp.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('Administración comercial: suscriptores, promociones, control de accesos y regalos', () => {
  let app;
  let prisma;
  let testEmail;
  let detectExpirations;
  let resolveAttempt;
  const uid = `cm${Date.now().toString(36)}`;
  const tokens = {};
  const secrets = {};
  const ids = {};
  const MASTER = 'ClaveMaestra2026QLC';

  const api = (who) => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokens[who]}`);
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body = {}) => auth(request(app).post(url)).send(body),
      put: (url, body = {}) => auth(request(app).put(url)).send(body),
    };
  };

  async function register(key) {
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, legalVersion: '2026-10-18', name: `Cliente ${key}`, email: `${key}-${uid}@test.qlc`, password: 'Password123!' });
    assert.equal(res.status, 201);
    const done = await completeTwoFactor(app, res.body.challengeToken);
    tokens[key] = done.token;
    ids[key] = (await prisma.user.findUnique({ where: { email: `${key}-${uid}@test.qlc` } })).id;
  }

  async function createAdmin(key, adminLevel) {
    const email = `${key}-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email, name: `Admin ${key}`, role: 'ADMIN', adminLevel, passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
    const done = await completeTwoFactor(app, login.body.challengeToken);
    tokens[key] = done.token;
    secrets[key] = done.secret;
    ids[key] = (await prisma.user.findUnique({ where: { email } })).id;
  }

  const code = async (key) => {
    await prisma.user.update({ where: { id: ids[key] }, data: { totpLastStep: null } });
    return codeAt(secrets[key], currentStep());
  };

  const buy = async (who, body) => {
    const checkout = await api(who).post('/api/payments/checkout', body);
    assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
    return checkout.body.attempt;
  };
  const pay = (who, attemptId, outcome = 'APPROVED') => api(who).post(`/api/payments/attempts/${attemptId}/simulate`, { outcome });
  const events = async (userId) => (await prisma.adminEvent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })).map((e) => e.type);
  const grantsOf = (userId) => prisma.accessGrant.findMany({ where: { userId, active: true } });
  const subscriber = async (userId) => (await api('general').get('/api/admin/subscribers')).body.rows.find((r) => r.id === userId);

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    ({ testEmail } = await import('../src/services/email.service.js'));
    ({ detectExpirations } = await import('../src/services/subscriber.service.js'));
    ({ resolveAttempt } = await import('../src/services/payments/payment.service.js'));
    await prisma.masterKey.deleteMany({ where: { id: 'general' } });
    await prisma.appSetting.deleteMany({ where: { key: { in: ['notifications', 'google-oauth'] } } });
    await createAdmin('general', 'FULL');
    await createAdmin('other', 'FULL');
    await createAdmin('edit', 'EDIT');
    await register('juan');
    await register('ana');
    await register('luis');
    await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { price: 2000 } });
    await prisma.productOffer.update({ where: { code: 'TOOLS_ALL' }, data: { price: 490 } });
    testEmail.setReady(true);
  });

  after(async () => {
    testEmail?.setReady(false);
    await prisma?.$disconnect();
  });

  test('Compra, renovación, cancelación, pago fallido y vencimiento quedan registrados y notificados', async () => {
    const first = await buy('juan', { offerCode: 'TOOLS_ALL' });
    assert.equal((await pay('juan', first.id)).status, 200);
    const renew = await buy('juan', { offerCode: 'TOOLS_ALL' });
    await pay('juan', renew.id);
    const failed = await buy('juan', { offerCode: 'FULL_ANNUAL' });
    await pay('juan', failed.id, 'REJECTED');
    assert.deepEqual((await pay('juan', first.id)).status, 400);
    let types = await events(ids.juan);
    assert.ok(types.includes('CONTRATADA'));
    assert.ok(types.includes('ACTIVADA'));
    assert.ok(types.includes('RENOVADA'));
    assert.ok(types.includes('PAGO_FALLIDO'));
    const mails = testEmail.outbox.filter((m) => m.template === 'adminEvent' && m.data.type === 'ACTIVADA' && m.data.userEmail === `juan-${uid}@test.qlc`);
    assert.ok(mails.some((m) => m.to === `general-${uid}@admin.qlc`));
    assert.ok(mails.some((m) => m.to === `edit-${uid}@admin.qlc`));
    const mail = mails[0];
    assert.equal(mail.data.period, 'MENSUAL');

    assert.equal((await subscriber(ids.juan)).state, 'ACTIVO');
    assert.equal((await api('juan').post('/api/payments/subscription/cancel')).status, 200);
    assert.equal((await subscriber(ids.juan)).state, 'CANCELADO');
    assert.ok((await events(ids.juan)).includes('CANCELADA'));
    assert.equal((await api('juan').get('/api/payments/access')).body.subscription.cancelledAt !== null, true);

    await prisma.accessGrant.updateMany({ where: { userId: ids.juan }, data: { startsAt: new Date(Date.now() - 400 * 86400000), expiresAt: new Date(Date.now() - 86400000) } });
    assert.ok((await detectExpirations()) >= 1);
    assert.equal(await detectExpirations(), 0);
    assert.ok((await events(ids.juan)).includes('VENCIDA'));
    const inactive = (await api('general').get('/api/admin/subscribers?state=INACTIVOS')).body.rows;
    assert.ok(inactive.some((r) => r.id === ids.juan));
    const log = (await api('general').get(`/api/admin/events?userId=${ids.juan}`)).body;
    assert.ok(log.length >= 6);
    assert.ok(log.every((e) => e.label));
  });

  test('Un importe distinto o un evento duplicado de la pasarela no activan acceso', async () => {
    const attempt = await buy('luis', { offerCode: 'FULL_ANNUAL' });
    const mismatch = await resolveAttempt(attempt.id, 'APPROVED', prisma, { paidAmount: 1 });
    assert.equal(mismatch.changed, false);
    assert.equal((await grantsOf(ids.luis)).length, 0);
    assert.ok((await events(ids.luis)).includes('IMPORTE_NO_COINCIDE'));
    const offer = await prisma.productOffer.findUnique({ where: { code: 'FULL_ANNUAL' } });
    const ok = await resolveAttempt(attempt.id, 'APPROVED', prisma, { paidAmount: offer.price === null ? null : Number(offer.price) });
    assert.equal(ok.changed, true);
    const dup = await resolveAttempt(attempt.id, 'APPROVED', prisma);
    assert.equal(dup.changed, false);
    assert.equal((await grantsOf(ids.luis)).length, 1);
  });

  test('Promoción de recuperación: el pago se confirma pero el acceso espera autorización del Administrador General', async () => {
    await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { price: 2000 } });
    const validUntil = new Date(Date.now() + 7 * 86400000).toISOString();
    assert.equal((await api('edit').post('/api/admin/promotions', { userId: ids.juan, offerCode: 'FULL_ANNUAL', discountPercent: 150, validUntil })).status, 400);
    const created = await api('edit').post('/api/admin/promotions', { userId: ids.juan, offerCode: 'FULL_ANNUAL', discountPercent: 50, validUntil, send: true });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.finalPrice, 1000);
    assert.ok(created.body.emailedAt);
    const promoMail = testEmail.outbox.find((m) => m.template === 'promotion' && m.data.code === created.body.code);
    assert.equal(promoMail.data.discount, 50);

    assert.equal((await api('ana').post('/api/payments/promo/check', { code: created.body.code })).status, 404);
    const check = await api('juan').post('/api/payments/promo/check', { code: created.body.code.toLowerCase() });
    assert.equal(check.status, 200);
    assert.equal(check.body.finalPrice, 1000);

    const before = (await grantsOf(ids.juan)).length;
    const attempt = await buy('juan', { promoCode: created.body.code });
    assert.equal(attempt.amount, 1000);
    assert.equal(attempt.kind, 'PROMO');
    const paid = await pay('juan', attempt.id);
    assert.equal(paid.status, 200);
    assert.equal(paid.body.attempt.authorization, 'PENDING');
    assert.equal((await grantsOf(ids.juan)).length, before);
    assert.equal(paid.body.access.full, null);
    assert.ok((await events(ids.juan)).includes('PAGO_PROMOCIONAL'));
    assert.ok(testEmail.outbox.some((m) => m.template === 'adminEvent' && m.data.type === 'PAGO_PROMOCIONAL'));
    assert.equal((await api('juan').post('/api/payments/checkout', { promoCode: created.body.code })).status, 409);
    assert.equal((await subscriber(ids.juan)).pendingAuthorization, true);
    ids.promoAttempt = attempt.id;

    await prisma.user.update({ where: { id: ids.ana }, data: { marketingOptOut: true } });
    assert.equal((await api('edit').post('/api/admin/promotions', { userId: ids.ana, offerCode: 'FULL_ANNUAL', discountPercent: 30, validUntil, send: true })).status, 409);
  });

  test('Contraseña maestra: exclusiva del Administrador General, con autenticador y bloqueo por intentos', async () => {
    const status = await api('general').get('/api/admin/general/status');
    assert.equal(status.body.configured, false);
    assert.equal(status.body.canClaim, true);
    assert.equal((await api('edit').post('/api/admin/general/setup', { password: MASTER, code: '000000' })).status, 403);
    assert.equal((await api('general').post('/api/admin/general/setup', { password: 'corta', code: await code('general') })).status, 400);
    const setup = await api('general').post('/api/admin/general/setup', { password: MASTER, code: await code('general') });
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    assert.equal(setup.body.isGeneralAdmin, true);
    assert.equal((await api('other').post('/api/admin/general/setup', { password: MASTER, code: await code('other') })).status, 409);
    const key = await prisma.masterKey.findUnique({ where: { id: 'general' } });
    assert.notEqual(key.hash, MASTER);

    const pending = (await api('general').get('/api/admin/general/pending')).body;
    assert.ok(pending.some((p) => p.id === ids.promoAttempt));
    assert.equal((await api('other').post(`/api/admin/general/pending/${ids.promoAttempt}/authorize`, { masterPassword: MASTER, code: await code('other') })).status, 403);
    assert.equal((await api('general').post(`/api/admin/general/pending/${ids.promoAttempt}/authorize`, { masterPassword: 'incorrecta', code: await code('general') })).status, 401);
    const authorized = await api('general').post(`/api/admin/general/pending/${ids.promoAttempt}/authorize`, { masterPassword: MASTER, code: await code('general') });
    assert.equal(authorized.status, 200, JSON.stringify(authorized.body));
    const grant = (await grantsOf(ids.juan)).find((g) => g.source === 'PROMOCION');
    assert.ok(grant);
    assert.equal(grant.grantedById, ids.general);
    assert.equal((await api('general').post(`/api/admin/general/pending/${ids.promoAttempt}/authorize`, { masterPassword: MASTER, code: await code('general') })).status, 404);
    const types = await events(ids.juan);
    assert.ok(types.includes('ACCESO_AUTORIZADO'));
    assert.ok(types.includes('RECUPERADA'));
    assert.equal((await subscriber(ids.juan)).state, 'ACTIVO');
  });

  test('Control de accesos: conceder, modificar vencimiento y retirar, con historial', async () => {
    const until = new Date(Date.now() + 60 * 86400000).toISOString();
    assert.equal((await api('general').post('/api/admin/general/grants', { userId: ids.ana, offerCode: 'TOOLS_ALL', expiresAt: until, reason: 'CORTESIA', masterPassword: MASTER })).status, 400);
    const granted = await api('general').post('/api/admin/general/grants', { userId: ids.ana, offerCode: 'TOOLS_ALL', expiresAt: until, reason: 'CORTESIA', note: 'Invitada al evento', masterPassword: MASTER, code: await code('general') });
    assert.equal(granted.status, 201, JSON.stringify(granted.body));
    assert.equal(granted.body.source, 'MANUAL');
    assert.equal((await api('ana').get('/api/payments/access')).body.access.mode, 'TOOLS');

    const later = new Date(Date.now() + 120 * 86400000).toISOString();
    const moved = await api('general').put(`/api/admin/general/grants/${granted.body.id}`, { expiresAt: later, masterPassword: MASTER, code: await code('general') });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(new Date(moved.body.expiresAt).toISOString(), later);

    const revoked = await api('general').post(`/api/admin/general/grants/${granted.body.id}/revoke`, { note: 'Fin de la cortesía', masterPassword: MASTER, code: await code('general') });
    assert.equal(revoked.status, 200);
    assert.equal((await api('ana').get('/api/payments/access')).body.access.mode, 'NONE');

    const found = (await api('general').get(`/api/admin/general/users?q=ana-${uid}`)).body;
    assert.equal(found[0].grants[0].grantedBy, 'Admin general');
    const history = (await api('general').get(`/api/admin/events?category=ACCESO&userId=${ids.ana}`)).body.map((e) => e.type);
    assert.deepEqual(history.sort(), ['ACCESO_CONCEDIDO', 'ACCESO_RETIRADO', 'VENCIMIENTO_MODIFICADO']);

    for (let i = 0; i < 5; i += 1) await api('general').post('/api/admin/general/grants', { userId: ids.ana, offerCode: 'TOOLS_ALL', expiresAt: until, reason: 'CORTESIA', masterPassword: 'mala', code: '123456' });
    assert.equal((await api('general').post('/api/admin/general/grants', { userId: ids.ana, offerCode: 'TOOLS_ALL', expiresAt: until, reason: 'CORTESIA', masterPassword: MASTER, code: await code('general') })).status, 429);
    await prisma.masterKey.update({ where: { id: 'general' }, data: { lockedUntil: null, failedAttempts: 0 } });
  });

  test('Regalos: el comprador recibe códigos únicos y el destinatario activa el acceso sin pagar', async () => {
    await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { price: 2000 } });
    const beforeAccess = (await api('luis').get('/api/payments/access')).body.access;
    const attempt = await buy('luis', { offerCode: 'FULL_ANNUAL', gift: { quantity: 2, message: 'Feliz cumpleaños', recipientName: 'Ana' } });
    assert.equal(attempt.amount, 4000);
    assert.equal(attempt.kind, 'GIFT');
    const paid = await pay('luis', attempt.id);
    assert.equal(paid.body.gifts.length, 2);
    assert.match(paid.body.gifts[0], /^QLC-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.notEqual(paid.body.gifts[0], paid.body.gifts[1]);
    assert.deepEqual((await api('luis').get('/api/payments/access')).body.access.full?.expiresAt, beforeAccess.full?.expiresAt);
    assert.ok(testEmail.outbox.some((m) => m.template === 'giftCodes'));

    const mine = (await api('luis').get('/api/gifts/mine')).body;
    assert.equal(mine.length, 2);
    assert.equal(mine[0].status, 'DISPONIBLE');

    const preview = await request(app).get(`/api/public/gifts/${paid.body.gifts[0].toLowerCase()}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.message, 'Feliz cumpleaños');
    assert.equal(preview.body.purchaser, undefined);

    const redeemed = await api('ana').post('/api/gifts/redeem', { code: paid.body.gifts[0] });
    assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
    assert.equal(redeemed.body.access.mode, 'FULL');
    assert.equal(Math.round((new Date(redeemed.body.expiresAt) - new Date(redeemed.body.startsAt)) / 86400000), 365);
    assert.equal((await api('juan').post('/api/gifts/redeem', { code: paid.body.gifts[0] })).status, 409);
    assert.equal((await api('general').post('/api/gifts/redeem', { code: paid.body.gifts[1] })).status, 403);
    assert.equal((await request(app).get(`/api/public/gifts/${paid.body.gifts[0]}`)).body.status, 'ACTIVADO');

    const again = await buy('luis', { offerCode: 'FULL_ANNUAL', gift: { quantity: 1 } });
    const extra = (await pay('luis', again.id)).body.gifts[0];
    const anaGrant = (await grantsOf(ids.ana)).find((g) => g.source === 'REGALO');
    const stacked = await api('ana').post('/api/gifts/redeem', { code: extra });
    assert.equal(new Date(stacked.body.startsAt).toISOString(), new Date(anaGrant.expiresAt).toISOString());

    const list = (await api('general').get('/api/admin/gifts')).body;
    const second = list.find((g) => g.code === paid.body.gifts[1]);
    assert.equal(second.purchaser.email, `luis-${uid}@test.qlc`);
    await prisma.giftCode.update({ where: { id: second.id }, data: { redeemBy: new Date(Date.now() - 1000) } });
    assert.equal((await api('juan').post('/api/gifts/redeem', { code: second.code })).status, 409);
    assert.equal((await api('general').post(`/api/admin/gifts/${second.id}/cancel`)).status, 400);
    await prisma.giftCode.update({ where: { id: second.id }, data: { redeemBy: new Date(Date.now() + 86400000) } });
    assert.equal((await api('edit').post(`/api/admin/gifts/${second.id}/cancel`)).status, 403);
    assert.equal((await api('general').post(`/api/admin/gifts/${second.id}/cancel`)).status, 200);
    assert.equal((await api('juan').post('/api/gifts/redeem', { code: second.code })).status, 409);

    assert.equal((await api('general').put('/api/admin/gifts/settings', { redeemDays: 90 })).body.redeemDays, 90);
    const types = (await prisma.adminEvent.findMany({ where: { category: 'REGALO' } })).map((e) => e.type);
    assert.ok(types.includes('REGALO_COMPRADO') && types.includes('REGALO_CANJEADO') && types.includes('REGALO_CANCELADO'));
  });

  test('Correo y notificaciones se configuran desde el panel: credenciales cifradas, destinatarios y avisos activables', async () => {
    assert.equal((await api('edit').put('/api/admin/mail-settings', { senderName: 'X' })).status, 403);
    const saved = await api('general').put('/api/admin/mail-settings', { clientId: 'cliente-123.apps.googleusercontent.com', clientSecret: 'secreto-super-privado', senderName: 'QLC Avisos', disabled: ['NUEVA_CITA'] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.source, 'PANEL');
    assert.equal(saved.body.hasSecret, true);
    assert.ok(!JSON.stringify(saved.body).includes('secreto-super-privado'));
    assert.ok(saved.body.groups.some((g) => g.events.some((e) => e.type === 'NUEVO_REGISTRO')));
    const row = await prisma.appSetting.findUnique({ where: { key: 'google-oauth' } });
    assert.ok(!JSON.stringify(row.value).includes('secreto-super-privado'));
    const { env } = await import('../src/config/env.js');
    assert.equal(env.google.clientId, 'cliente-123.apps.googleusercontent.com');
    assert.equal(env.google.clientSecret, 'secreto-super-privado');
    await api('general').put('/api/admin/mail-settings', { disabled: ['DATOS_COMPARTIDOS'] });
    await prisma.googleIntegration.upsert({ where: { service: 'GMAIL' }, create: { service: 'GMAIL', email: 'avisos@qlc.test', status: 'DISCONNECTED' }, update: { email: 'avisos@qlc.test' } });
    const lead = await request(app).post('/api/public/leads').send({ name: 'Prospecto', email: `lead-${uid}@test.qlc`, interest: 'GENERAL', message: 'Quiero información', acceptPrivacy: true });
    assert.equal(lead.status, 201, JSON.stringify(lead.body));
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(testEmail.outbox.some((m) => m.template === 'adminEvent' && m.data.type === 'NUEVA_SOLICITUD' && m.to === 'avisos@qlc.test'));
    const before = testEmail.outbox.length;
    assert.equal((await api('juan').post('/api/auth/data-share/start', {})).status, 200);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(await prisma.adminEvent.findFirst({ where: { type: 'DATOS_COMPARTIDOS', userId: ids.juan } }));
    assert.ok(!testEmail.outbox.slice(before).some((m) => m.data?.type === 'DATOS_COMPARTIDOS'));
    await prisma.googleIntegration.update({ where: { service: 'GMAIL' }, data: { email: null } });
    await api('general').put('/api/admin/mail-settings', { disabled: [] });
    await prisma.appSetting.deleteMany({ where: { key: 'google-oauth' } });
    const { applyGoogleCredentials } = await import('../src/services/mailSettings.service.js');
    await applyGoogleCredentials();
  });
});

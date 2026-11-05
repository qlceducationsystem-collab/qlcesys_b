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

  test('Gmail solo cuenta como conectado si Google dio el permiso de enviar', async () => {
    const { gmailCanSend } = await import('../src/services/email.service.js');
    const { buildAuthUrl, handleCallback } = await import('../src/services/google/oauth.js');
    const { env } = await import('../src/config/env.js');
    assert.equal(gmailCanSend({ status: 'CONNECTED', scopes: 'openid email' }), false);
    assert.equal(gmailCanSend({ status: 'CONNECTED', scopes: 'openid email https://www.googleapis.com/auth/gmail.send' }), true);
    assert.equal(gmailCanSend({ status: 'ERROR', scopes: 'https://www.googleapis.com/auth/gmail.send' }), false);
    const saved = { ...env.google };
    const realFetch = global.fetch;
    env.google.clientId = 'x.apps.googleusercontent.com';
    env.google.clientSecret = 'secreto';
    global.fetch = async () => ({ ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid email' }) });
    try {
      const state = new URL(buildAuthUrl('GMAIL', 'admin')).searchParams.get('state');
      await assert.rejects(handleCallback({ code: 'c', state }), /no dio permiso/);
    } finally {
      global.fetch = realFetch;
      Object.assign(env.google, saved);
    }
  });

  test('El correo va bien formado: líneas cortas, fecha, identificador y texto recuperable', async () => {
    const { buildMime } = await import('../src/services/google/gmail.js');
    const html = `<p>${'Información financiera '.repeat(400)}</p>`;
    const mime = buildMime({ to: 'a@test.qlc', subject: 'Prueba · QLC', html, text: 'Hola', from: '=?UTF-8?B?UUxD?= <envia@gmail.com>' });
    assert.ok(mime.split('\r\n').every((line) => line.length <= 998));
    assert.match(mime, /^Date: /m);
    assert.match(mime, /^Message-ID: <[^>]+@gmail\.com>$/m);
    const parts = mime.split(/--qlc_[0-9a-f]+/);
    const bodyOf = (part) => Buffer.from(part.split('\r\n\r\n')[1].replace(/\s+/g, ''), 'base64').toString('utf8');
    assert.equal(bodyOf(parts[1]), 'Hola');
    assert.equal(bodyOf(parts[2]), html);
    assert.ok(mime.endsWith('--\r\n'));
  });

  test('Cada persona recibe el correo en el idioma que eligió', async () => {
    const { sendEmail } = await import('../src/services/email.service.js');
    const { englishTemplateNames, renderEmail, templateNames, translateValue } = await import('../src/services/emailTemplates.js');
    assert.deepEqual(englishTemplateNames().sort(), templateNames().sort());
    assert.equal((await api('tools').put('/api/auth/language', { language: 'fr' })).status, 400);
    assert.equal((await api('tools').put('/api/auth/language', { language: 'en' })).status, 200);
    assert.equal((await api('tools').get('/api/auth/me')).body.user.language, 'en');
    testEmail.setReady(true);
    const start = testEmail.outbox.length;
    const toolsEmail = `tools-${uid}@test.qlc`;
    await sendEmail('accessExpired', toolsEmail, { name: 'Ana', product: 'Herramientas financieras QLC' });
    await sendEmail('accessExpired', `mc-${uid}@test.qlc`, { name: 'Ana', product: 'Herramientas financieras QLC' });
    await sendEmail('verifyEmail', `nuevo-${uid}@test.qlc`, { code: '123456', minutes: 10 }, { lang: 'en' });
    const mine = testEmail.outbox.slice(start).filter((m) => ['accessExpired', 'verifyEmail'].includes(m.template));
    const [en, es, fresh] = mine;
    assert.equal(en.lang, 'en');
    assert.match(en.subject, /Your QLC subscription/);
    assert.equal(es.lang, 'es');
    assert.match(es.subject, /Tu suscripción/);
    assert.match(fresh.subject, /verification code/);
    assert.ok(renderEmail('accessExpired', { name: 'Ana', product: 'Herramientas financieras QLC' }, 'en').body.includes('QLC financial tools'));
    assert.equal(translateValue('Vigente hasta 2026-12-01', 'en'), 'Valid until 2026-12-01');
    assert.equal(translateValue('Módulo 3 · Construcción de portafolio', 'en'), 'Module 3 · Portfolio construction');
    assert.equal(translateValue('Vigente hasta 2026-12-01', 'es'), 'Vigente hasta 2026-12-01');
    testEmail.setReady(false);
  });

  test('Lo que hace un cliente se avisa a cada administrador en su idioma', async () => {
    const adminEn = `admin-en-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email: adminEn, name: 'Admin EN', role: 'ADMIN', adminLevel: 'VIEW', language: 'en', passwordHash: 'x' } });
    testEmail.setReady(true);
    const start = testEmail.outbox.length;
    const done = await api('mc').post('/api/academy/modules/7/masterclass/complete');
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const pick = () => testEmail.outbox.slice(start).filter((m) => m.template === 'adminEvent' && m.data.type === 'MASTERCLASS_TERMINADA');
    for (let i = 0; i < 50 && !pick().some((m) => m.to === adminEn); i += 1) await new Promise((r) => setTimeout(r, 100));
    const sent = pick();
    const english = sent.find((m) => m.to === adminEn);
    const spanish = sent.find((m) => m.to === `admin-${uid}@admin.qlc`);
    testEmail.setReady(false);
    assert.equal(english?.lang, 'en');
    assert.match(english.subject, /Client finished a Masterclass/);
    assert.equal(spanish?.lang, 'es');
    assert.match(spanish.subject, /Cliente terminó una Masterclass/);
  });

  test('La prueba de correo sale en el idioma que tiene el panel', async () => {
    testEmail.setReady(true);
    const start = testEmail.outbox.length;
    const res = await api('admin').post('/api/admin/integrations/gmail/test', { to: 'destino@test.qlc', language: 'en' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const mail = testEmail.outbox.slice(start).find((m) => m.template === 'test');
    testEmail.setReady(false);
    assert.equal(mail.lang, 'en');
    assert.match(mail.subject, /Test email/);
    await prisma.appSetting.deleteMany({ where: { key: 'mail-transport' } });
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

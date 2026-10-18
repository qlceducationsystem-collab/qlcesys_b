import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { completeTwoFactor, nextCode } from './helpers.js';
import { base32Encode, codeAt, matchStep } from '../src/utils/totp.js';
import { startKeepAlive } from '../src/services/keepAlive.service.js';

describe('TOTP (RFC 6238)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  test('vectores oficiales de 6 dígitos', () => {
    assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.equal(codeAt(secret, Math.floor(59 / 30)), '287082');
    assert.equal(codeAt(secret, Math.floor(1111111109 / 30)), '081804');
    assert.equal(codeAt(secret, Math.floor(1234567890 / 30)), '005924');
  });

  test('acepta ±1 intervalo y rechaza formatos inválidos', () => {
    const now = 1234567890 * 1000;
    assert.equal(matchStep(secret, codeAt(secret, 41152263 - 1), { now }), 41152262);
    assert.equal(matchStep(secret, codeAt(secret, 41152263 + 3), { now }), null);
    assert.equal(matchStep(secret, '12ab56', { now }), null);
  });

  test('keep-alive solo se activa con URL y bandera', () => {
    assert.equal(startKeepAlive({ enabled: false, url: 'https://x.onrender.com', intervalMinutes: 5 }), null);
    assert.equal(startKeepAlive({ enabled: true, url: '', intervalMinutes: 5 }), null);
    const timer = startKeepAlive({ enabled: true, url: 'http://127.0.0.1:9', intervalMinutes: 5 });
    assert.ok(timer);
    clearInterval(timer);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('Verificación en dos pasos (integración)', () => {
  let app;
  let prisma;
  const email = `twofa-${Date.now().toString(36)}@test.qlc`;
  const state = {};

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
  });

  after(async () => prisma?.$disconnect());

  test('el registro exige configurar 2FA antes de dar acceso', async () => {
    const noLegal = await request(app).post('/api/auth/register').send({ name: 'Sin aceptar', email: 'legal-' + email, password: 'Password123!' });
    assert.equal(noLegal.status, 400);
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, legalVersion: '2026-10-18', name: 'Cliente 2FA', email, password: 'Password123!' });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'SETUP_2FA');
    assert.equal(res.body.token, undefined);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.challengeToken}`)).status, 401);
    const again = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
    assert.equal(again.body.status, 'SETUP_2FA');
    const wrong = await request(app).post('/api/auth/2fa/setup').send({ challengeToken: again.body.challengeToken });
    assert.match(wrong.body.qr, /^data:image\/png;base64,/);
    assert.match(wrong.body.otpauthUrl, /^otpauth:\/\/totp\//);
    assert.equal((await request(app).post('/api/auth/2fa/activate').send({ challengeToken: again.body.challengeToken, code: '000000' })).status, 401);
    const done = await completeTwoFactor(app, again.body.challengeToken);
    assert.equal(done.activated.body.status, 'OK');
    assert.equal(done.activated.body.user.twoFactorEnabled, true);
    assert.ok((await prisma.user.findUnique({ where: { email } })).legalAcceptedAt);
    state.secret = done.secret;
    const stored = await prisma.user.findUnique({ where: { email } });
    assert.notEqual(stored.totpSecret, done.secret);
    assert.equal(stored.totpPendingSecret, null);
  });

  test('después puede entrar con contraseña o con código 2FA, sin reutilizar códigos', async () => {
    const byPassword = await request(app).post('/api/auth/login').send({ email, password: 'Password123!' });
    assert.equal(byPassword.body.status, 'OK');
    assert.ok(byPassword.body.token);
    const code = nextCode(state.secret, 1);
    const byCode = await request(app).post('/api/auth/login/2fa').send({ email, code });
    assert.equal(byCode.status, 200);
    assert.ok(byCode.body.token);
    assert.equal((await request(app).post('/api/auth/login/2fa').send({ email, code })).status, 401);
    assert.equal((await request(app).post('/api/auth/2fa/setup').send({ challengeToken: byPassword.body.token })).status, 401);
  });

  test('restablecer contraseña requiere el 2FA registrado y bloquea tras intentos fallidos', async () => {
    assert.equal((await request(app).post('/api/auth/reset-password').send({ email, code: '000000', password: 'NuevaClave123!' })).status, 401);
    await prisma.user.update({ where: { email }, data: { totpLastStep: null, totpFailedAttempts: 0 } });
    const ok = await request(app).post('/api/auth/reset-password').send({ email, code: nextCode(state.secret, 0), password: 'NuevaClave123!' });
    assert.equal(ok.status, 200);
    assert.equal((await request(app).post('/api/auth/login').send({ email, password: 'NuevaClave123!' })).body.status, 'OK');
    for (let i = 0; i < 5; i += 1) await request(app).post('/api/auth/login/2fa').send({ email, code: '000000' });
    assert.equal((await request(app).post('/api/auth/login/2fa').send({ email, code: nextCode(state.secret, -1) })).status, 429);
    const noTwoFactor = await request(app).post('/api/auth/register').send({ acceptLegal: true, legalVersion: '2026-10-18', name: 'Sin 2FA', email: `no-${email}`, password: 'Password123!' });
    assert.equal(noTwoFactor.status, 201);
    assert.equal((await request(app).post('/api/auth/reset-password').send({ email: `no-${email}`, code: '123456', password: 'Otra12345!' })).status, 401);
  });
});

import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('Restablecer contraseña con código por correo', () => {
  let app;
  let prisma;
  let testEmail;
  const uid = `pr${Date.now().toString(36)}`;
  const email = `reset-${uid}@test.qlc`;
  let token;
  const post = (url, body) => request(app).post(url).send(body);
  const lastCode = (to) => testEmail.outbox.filter((m) => m.to === to && m.template === 'passwordReset').at(-1)?.data.code;
  const wait = () => new Promise((r) => setTimeout(r, 50));
  const until = async (check) => {
    for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 20));
  };

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    ({ testEmail } = await import('../src/services/email.service.js'));
    testEmail.setReady(false);
    const res = await post('/api/auth/register', { acceptLegal: true, legalVersion: '2026-10-18', name: 'Cliente Reset', email, password: 'Password123!' });
    assert.equal(res.status, 201);
    token = (await completeTwoFactor(app, res.body.challengeToken)).token;
  });

  test('Sin correo configurado avisa que no está disponible', async () => {
    testEmail.setReady(false);
    assert.equal((await post('/api/auth/password-reset/request', { email })).status, 503);
  });

  test('La respuesta no revela si el correo existe y no envía nada a cuentas inexistentes', async () => {
    testEmail.setReady(true);
    const ghost = await post('/api/auth/password-reset/request', { email: `nadie-${uid}@test.qlc` });
    const real = await post('/api/auth/password-reset/request', { email });
    assert.equal(ghost.status, 200);
    assert.equal(ghost.body.message, real.body.message);
    await until(() => lastCode(email));
    assert.equal(lastCode(`nadie-${uid}@test.qlc`), undefined);
    assert.ok(lastCode(email));
    assert.equal((await post('/api/auth/password-reset/request', { email })).status, 200);
    await wait();
    assert.equal(testEmail.outbox.filter((m) => m.to === email && m.template === 'passwordReset').length, 1);
  });

  test('Un código equivocado no cambia nada y a los 5 intentos se invalida', async () => {
    const code = lastCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    const res = await post('/api/auth/password-reset/confirm', { email, code: wrong, password: 'OtraClave123!' });
    assert.equal(res.status, 400);
    const user = await prisma.user.findUnique({ where: { email } });
    assert.ok(user.totpEnabledAt);
    assert.ok(await bcrypt.compare('Password123!', user.passwordHash));
    for (let i = 0; i < 4; i += 1) await post('/api/auth/password-reset/confirm', { email, code: wrong, password: 'OtraClave123!' });
    assert.equal((await post('/api/auth/password-reset/confirm', { email, code, password: 'OtraClave123!' })).status, 400);
  });

  test('Un código vencido no sirve', async () => {
    await prisma.user.update({ where: { email }, data: { resetCodeExpiresAt: new Date(0) } });
    await post('/api/auth/password-reset/request', { email });
    await wait();
    const code = lastCode(email);
    await prisma.user.update({ where: { email }, data: { resetCodeExpiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await post('/api/auth/password-reset/confirm', { email, code, password: 'OtraClave123!' })).status, 400);
  });

  test('El código correcto cambia la contraseña, reinicia Authenticator y obliga a registrarlo', async () => {
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status, 200);
    await prisma.user.update({ where: { email }, data: { resetCodeExpiresAt: new Date(0) } });
    await post('/api/auth/password-reset/request', { email });
    await wait();
    const code = lastCode(email);
    const ok = await post('/api/auth/password-reset/confirm', { email, code, password: 'NuevaClave123!' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await post('/api/auth/password-reset/confirm', { email, code, password: 'NuevaClave456!' })).status, 400);
    const user = await prisma.user.findUnique({ where: { email } });
    assert.equal(user.totpEnabledAt, null);
    assert.equal(user.totpSecret, null);
    assert.equal(user.resetCodeHash, null);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status, 401);
    assert.equal((await post('/api/auth/login', { email, password: 'Password123!' })).status, 401);
    const login = await post('/api/auth/login', { email, password: 'NuevaClave123!' });
    assert.equal(login.status, 200);
    assert.equal(login.body.status, 'SETUP_2FA');
    await new Promise((r) => setTimeout(r, 1100));
    const fresh = await completeTwoFactor(app, login.body.challengeToken);
    assert.ok(fresh.token);
    assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${fresh.token}`)).status, 200);
    assert.ok((await prisma.user.findUnique({ where: { email } })).totpEnabledAt);
  });

  test('Las cuentas de administrador no se restablecen por correo', async () => {
    const adminEmail = `adm-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email: adminEmail, name: 'Admin', role: 'ADMIN', adminLevel: 'FULL', passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    await post('/api/auth/password-reset/request', { email: adminEmail });
    await wait();
    assert.equal(lastCode(adminEmail), undefined);
    testEmail.setReady(false);
  });
});

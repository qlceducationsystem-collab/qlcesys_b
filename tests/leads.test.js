import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('Solicitudes de información (integración)', () => {
  let app;
  let prisma;
  const uid = Date.now().toString(36);
  const tokens = {};
  const lead = { name: 'Prospecto', email: `lead-${uid}@test.qlc`, phone: '4420000000', interest: 'TRADING_ACADEMY', message: 'Quiero conocer el temario', acceptPrivacy: true, sourcePath: '/trading-academy' };

  async function admin(key, adminLevel) {
    const email = `${key}-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email, name: key, role: 'ADMIN', adminLevel, passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
    tokens[key] = (await completeTwoFactor(app, login.body.challengeToken)).token;
  }

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    await admin('leadview', 'VIEW');
    await admin('leadedit', 'EDIT');
  });

  after(async () => prisma?.$disconnect());

  test('cualquier visitante puede solicitar información aceptando el aviso de privacidad', async () => {
    assert.equal((await request(app).post('/api/public/leads').send({ ...lead, acceptPrivacy: false })).status, 400);
    assert.equal((await request(app).post('/api/public/leads').send({ ...lead, interest: 'OTRO' })).status, 400);
    const ok = await request(app).post('/api/public/leads').send(lead);
    assert.equal(ok.status, 201);
    assert.ok(ok.body.id);
    assert.equal(ok.body.email, undefined);
  });

  test('solo administradores consultan; VIEW no puede cambiar el estado', async () => {
    assert.equal((await request(app).get('/api/admin/leads')).status, 401);
    const list = await request(app).get('/api/admin/leads?interest=TRADING_ACADEMY').set('Authorization', `Bearer ${tokens.leadview}`);
    assert.equal(list.status, 200);
    const item = list.body.items.find((l) => l.email === lead.email);
    assert.equal(item.status, 'NEW');
    assert.equal((await request(app).patch(`/api/admin/leads/${item.id}`).set('Authorization', `Bearer ${tokens.leadview}`).send({ status: 'CONTACTED' })).status, 403);
    const updated = await request(app).patch(`/api/admin/leads/${item.id}`).set('Authorization', `Bearer ${tokens.leadedit}`).send({ status: 'CONTACTED', adminNotes: 'Llamada agendada' });
    assert.equal(updated.body.status, 'CONTACTED');
    assert.ok(await prisma.adminAuditLog.count({ where: { module: 'SOLICITUDES', entityId: item.id } }));
  });
});

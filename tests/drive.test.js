import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

run('Google Drive con la misma aplicación OAuth2 de Gmail', () => {
  let app;
  let prisma;
  let env;
  let realFetch;
  let encryptSecret;
  let driveError = null;
  const uid = `dr${Date.now().toString(36)}`;
  const tokens = {};
  const created = [];
  const uploaded = [];
  const deleted = [];
  const revoked = [];

  const json = (data, status = 200, headers = {}) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data), headers: new Headers(headers) });

  const stubFetch = async (url, opt = {}) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) return json({ access_token: 'acceso', expires_in: 3600 });
    if (u.includes('oauth2.googleapis.com/revoke')) {
      revoked.push(u);
      return json({});
    }
    if (driveError) return json({ error: { message: driveError } }, 403);
    if (u.includes('/upload/drive/v3/files?uploadType=resumable')) {
      uploaded.push(JSON.parse(opt.body));
      return json({}, 200, { location: 'https://upload.test/sesion' });
    }
    if (u === 'https://upload.test/sesion') return json({ id: `archivo-${uploaded.length}`, name: uploaded.at(-1).name });
    if (u.includes('/drive/v3/files?fields=id')) {
      const body = JSON.parse(opt.body);
      created.push(body);
      return json({ id: `carpeta-${created.length}` });
    }
    if (opt.method === 'DELETE') {
      deleted.push(u);
      return json({}, 200);
    }
    if (/\/drive\/v3\/files\/[^?]+\?fields=id,trashed/.test(u)) return json({ id: 'x', trashed: false });
    throw new Error(`fetch no esperado ${u}`);
  };

  const api = (method, url, body) => request(app)[method](url).set('Authorization', `Bearer ${tokens.admin}`).send(body);

  const connect = (service, email) => prisma.googleIntegration.upsert({
    where: { service },
    create: { service, status: 'CONNECTED', email, scopes: `openid email ${service === 'DRIVE' ? DRIVE_SCOPE : GMAIL_SCOPE}`, encryptedRefreshToken: encryptSecret(`refresh-${service}`) },
    update: { status: 'CONNECTED', email, scopes: `openid email ${service === 'DRIVE' ? DRIVE_SCOPE : GMAIL_SCOPE}`, encryptedRefreshToken: encryptSecret(`refresh-${service}`), driveFolders: null, lastError: null },
  });

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    ({ env } = await import('../src/config/env.js'));
    ({ encryptSecret } = await import('../src/utils/crypto.js'));
    env.tokenEncryptionKey ||= process.env.TOKEN_ENCRYPTION_KEY;
    const email = `admin-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email, name: 'Admin', role: 'ADMIN', adminLevel: 'FULL', passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
    tokens.admin = (await completeTwoFactor(app, login.body.challengeToken)).token;
    const edit = `edit-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email: edit, name: 'Edit', role: 'ADMIN', adminLevel: 'EDIT', passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const editLogin = await request(app).post('/api/auth/login').send({ email: edit, password: 'AdminPass123!' });
    tokens.edit = (await completeTwoFactor(app, editLogin.body.challengeToken)).token;
    realFetch = global.fetch;
  });

  beforeEach(async () => {
    Object.assign(env.google, { clientId: 'misma-app.apps.googleusercontent.com', clientSecret: 'secreto' });
    await prisma.googleIntegration.deleteMany({});
    await prisma.appSetting.deleteMany({ where: { key: 'drive-status' } });
    const { resetTokenCache } = await import('../src/services/google/oauth.js');
    resetTokenCache();
    Object.assign(created, []);
    created.length = 0;
    uploaded.length = 0;
    deleted.length = 0;
    revoked.length = 0;
    driveError = null;
    global.fetch = stubFetch;
  });

  after(async () => {
    global.fetch = realFetch;
    await prisma.googleIntegration.deleteMany({});
    await prisma.appSetting.deleteMany({ where: { key: 'drive-status' } });
  });

  test('Drive se conecta con el mismo Client ID de Gmail y pide solo su permiso', async () => {
    const drive = new URL((await api('get', '/api/admin/integrations/drive/connect')).body.url);
    const gmail = new URL((await api('get', '/api/admin/integrations/gmail/connect')).body.url);
    assert.equal(drive.searchParams.get('client_id'), 'misma-app.apps.googleusercontent.com');
    assert.equal(drive.searchParams.get('client_id'), gmail.searchParams.get('client_id'));
    assert.equal(drive.searchParams.get('redirect_uri'), gmail.searchParams.get('redirect_uri'));
    assert.ok(drive.searchParams.get('scope').includes(DRIVE_SCOPE));
    assert.ok(!drive.searchParams.get('scope').includes('gmail'));
    assert.equal((await request(app).get('/api/admin/integrations/drive/connect').set('Authorization', `Bearer ${tokens.edit}`)).status, 403);
  });

  test('Si Google no da el permiso de Drive se explica y no se guarda', async () => {
    const { handleCallback, buildAuthUrl } = await import('../src/services/google/oauth.js');
    const state = new URL(buildAuthUrl('DRIVE', 'a')).searchParams.get('state');
    global.fetch = async () => json({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid email' });
    await assert.rejects(handleCallback({ code: 'c', state }), /Google Drive/);
    assert.equal(await prisma.googleIntegration.count({ where: { service: 'DRIVE' } }), 0);
    const view = (await api('get', '/api/admin/integrations/drive')).body;
    assert.equal(view.connected, false);
    assert.ok(!JSON.stringify(view).includes('encrypted'));
    assert.ok(!JSON.stringify(view).includes('secreto'));
  });

  test('Probar conexión crea la carpeta, sube y borra un archivo; registra el resultado', async () => {
    assert.equal((await api('post', '/api/admin/integrations/drive/test', {})).status, 400);
    await connect('DRIVE', 'qlc@test.qlc');
    const res = await api('post', '/api/admin/integrations/drive/test', {});
    assert.equal(res.status, 200);
    assert.equal(res.body.connected, true);
    assert.equal(res.body.lastTest.ok, true);
    assert.equal(created[0].name, 'QLC Financial Education');
    assert.equal(uploaded.length, 1);
    assert.equal(deleted.length, 1);
    assert.match(res.body.folderUrl, /drive\.google\.com\/drive\/folders\/carpeta-1$/);
  });

  test('Si la Drive API no está activada lo dice claro', async () => {
    await connect('DRIVE', 'qlc@test.qlc');
    driveError = 'Google Drive API has not been used in project 1 before or it is disabled. accessNotConfigured';
    const res = await api('post', '/api/admin/integrations/drive/test', {});
    assert.equal(res.body.lastTest.ok, false);
    assert.match(res.body.lastTest.error, /Google Drive API no está activada/);
  });

  test('Sin el permiso de Drive no cuenta como conectado', async () => {
    const { driveConnected } = await import('../src/services/google/drive.js');
    await connect('DRIVE', 'qlc@test.qlc');
    assert.equal(await driveConnected(), true);
    await prisma.googleIntegration.update({ where: { service: 'DRIVE' }, data: { scopes: 'openid email' } });
    assert.equal(await driveConnected(), false);
    assert.equal((await api('get', '/api/admin/integrations/drive')).body.missingScope, true);
  });

  test('Los comprobantes van en Clientes / cliente / Pagos y reutilizan las carpetas', async () => {
    const { ensureClientFolder, uploadBuffer } = await import('../src/services/google/drive.js');
    await connect('DRIVE', 'qlc@test.qlc');
    const user = { id: 'u1', name: 'Ana/Pérez', email: 'ana@test.qlc' };
    const parentId = await ensureClientFolder(user, 'Pagos');
    assert.deepEqual(created.map((c) => c.name), ['QLC Financial Education', 'Clientes', 'Ana Pérez - ana@test.qlc', 'Pagos']);
    assert.equal(created[3].parents[0], created.length && 'carpeta-3');
    assert.equal(await ensureClientFolder(user, 'Pagos'), parentId);
    assert.equal(created.length, 4);
    const file = await uploadBuffer({ buffer: Buffer.from('x'), name: 'Evidencia_1_a.png', mimeType: 'image/png', parentId });
    assert.ok(file.id);
    assert.deepEqual(uploaded[0].parents, [parentId]);
  });

  test('Desconectar Drive no le quita el permiso a Gmail si comparten cuenta', async () => {
    await connect('DRIVE', 'qlc@test.qlc');
    await connect('GMAIL', 'qlc@test.qlc');
    assert.equal((await api('delete', '/api/admin/integrations/drive')).status, 200);
    assert.equal(revoked.length, 0);
    assert.equal((await prisma.googleIntegration.findUnique({ where: { service: 'DRIVE' } })).status, 'DISCONNECTED');
    assert.equal((await prisma.googleIntegration.findUnique({ where: { service: 'GMAIL' } })).status, 'CONNECTED');
    await api('delete', '/api/admin/integrations/gmail');
    assert.equal(revoked.length, 1);
  });

  test('Con cuentas distintas, desconectar Drive sí revoca su permiso', async () => {
    await connect('DRIVE', 'drive@test.qlc');
    await connect('GMAIL', 'correo@test.qlc');
    await api('delete', '/api/admin/integrations/drive');
    assert.equal(revoked.length, 1);
    assert.equal((await prisma.googleIntegration.findUnique({ where: { service: 'GMAIL' } })).status, 'CONNECTED');
  });
});

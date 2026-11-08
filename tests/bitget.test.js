import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { completeTwoFactor } from './helpers.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(40, 2)]);
const FAKE = Buffer.from('esto no es una imagen aunque diga png');

run('País de residencia, Mercado Pago solo para México y transferencia interna Bitget', () => {
  let app;
  let prisma;
  let storage;
  let offer;
  const uid = `bg${Date.now().toString(36)}`;
  const QLC_UID = '5566778899';
  const tokens = {};
  const ids = {};
  const drive = new Map();
  let failUploadsAfter = Infinity;
  let uploads = 0;
  let order = 0;

  const nextOrder = () => `${uid}${(order += 1)}`.toUpperCase();
  const api = (who) => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokens[who]}`);
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body = {}) => auth(request(app).post(url)).send(body),
      put: (url, body = {}) => auth(request(app).put(url)).send(body),
      del: (url) => auth(request(app).delete(url)),
    };
  };

  const report = (who, url, { orderNumber, transferredAt = new Date(Date.now() - 3600000).toISOString(), files = [['comprobante.png', PNG]], removeFileIds = [], method = 'post' } = {}) => {
    let req = request(app)[method](url).set('Authorization', `Bearer ${tokens[who]}`);
    if (orderNumber !== undefined) req = req.field('orderNumber', orderNumber);
    req = req.field('transferredAt', transferredAt);
    for (const id of removeFileIds) req = req.field('removeFileIds', id);
    for (const [name, buffer] of files) req = req.attach('files', buffer, name);
    return req;
  };

  async function register(key, residenceCountry) {
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, residenceCountry, legalVersion: '2026-10-18', name: `Cliente ${key}`, email: `${key}-${uid}@test.qlc`, password: 'Password123!' });
    assert.equal(res.status, 201);
    tokens[key] = (await completeTwoFactor(app, res.body.challengeToken)).token;
    ids[key] = (await prisma.user.findUnique({ where: { email: `${key}-${uid}@test.qlc` } })).id;
  }

  const checkout = async (who, provider) => {
    const res = await api(who).post('/api/payments/checkout', { offerCode: 'FULL_ANNUAL', ...(provider ? { provider } : {}) });
    return res;
  };

  const resetCaches = async () => {
    (await import('../src/services/payments/paymentSettings.service.js')).resetPaymentSettingsCache();
    (await import('../src/services/payments/bitgetSettings.service.js')).resetBitgetCache();
  };

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    const { createApp } = await import('../src/app.js');
    app = createApp();
    ({ prisma } = await import('../src/config/prisma.js'));
    ({ storage } = await import('../src/services/payments/bitgetReport.service.js'));
    const { encryptSecret } = await import('../src/utils/crypto.js');
    Object.assign(storage, {
      connected: async () => true,
      folder: async (user) => `folder-${user.id}`,
      upload: async ({ name, mimeType, buffer, parentId }) => {
        uploads += 1;
        if (uploads > failUploadsAfter) throw new Error('Drive caído');
        const id = `drive-${uploads}-${uid}`;
        drive.set(id, { name, mimeType, buffer, parentId });
        return { id };
      },
      remove: async (id) => {
        drive.delete(id);
      },
      stream: async (id, _range, res) => {
        const f = drive.get(id);
        res.setHeader('Content-Type', f.mimeType);
        res.end(f.buffer);
      },
    });
    await prisma.appSetting.deleteMany({ where: { key: { in: ['mercadopago', 'bitget'] } } });
    await resetCaches();
    await prisma.googleIntegration.upsert({ where: { service: 'DRIVE' }, create: { service: 'DRIVE', status: 'CONNECTED', scopes: 'https://www.googleapis.com/auth/drive.file', encryptedRefreshToken: encryptSecret('r') }, update: { status: 'CONNECTED', scopes: 'https://www.googleapis.com/auth/drive.file', encryptedRefreshToken: encryptSecret('r') } });
    for (const [key, level] of [['admin', 'FULL'], ['edit', 'EDIT']]) {
      const email = `${key}-${uid}@admin.qlc`;
      await prisma.user.create({ data: { email, name: `Admin ${key}`, role: 'ADMIN', adminLevel: level, passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
      const login = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
      tokens[key] = (await completeTwoFactor(app, login.body.challengeToken)).token;
    }
    await register('ana', 'MX');
    await register('bob', 'US');
    await register('cam', 'CO');
    offer = await prisma.productOffer.update({ where: { code: 'FULL_ANNUAL' }, data: { price: 1000, currency: 'MXN', active: true, billingCycle: null } });
  });

  after(async () => {
    await prisma.appSetting.deleteMany({ where: { key: { in: ['mercadopago', 'bitget'] } } });
    await prisma.googleIntegration.deleteMany({ where: { service: 'DRIVE' } });
    await resetCaches();
  });

  test('El país de residencia es obligatorio al registrarse y se guarda con el usuario', async () => {
    const res = await request(app).post('/api/auth/register').send({ acceptLegal: true, legalVersion: '2026-10-18', name: 'Sin', email: `sin-${uid}@test.qlc`, password: 'Password123!' });
    assert.equal(res.status, 400);
    const bad = await request(app).post('/api/auth/register').send({ acceptLegal: true, residenceCountry: 'XX', legalVersion: '2026-10-18', name: 'Sin', email: `sin-${uid}@test.qlc`, password: 'Password123!' });
    assert.equal(bad.status, 400);
    assert.equal((await prisma.user.findUnique({ where: { id: ids.ana } })).residenceCountry, 'MX');
    assert.equal((await api('bob').get('/api/auth/me')).body.user.residenceCountry, 'US');
    await prisma.user.update({ where: { id: ids.cam }, data: { residenceCountry: null } });
    assert.equal((await api('cam').put('/api/auth/residence-country', { residenceCountry: 'CO' })).status, 200);
    assert.equal((await api('cam').put('/api/auth/residence-country', { residenceCountry: 'MX' })).status, 409);
    assert.equal((await prisma.user.findUnique({ where: { id: ids.cam } })).residenceCountry, 'CO');
    const patch = (who, residenceCountry) => request(app).patch(`/api/admin/clients/${ids.cam}/residence-country`).set('Authorization', `Bearer ${tokens[who]}`).send({ residenceCountry });
    assert.equal((await patch('edit', 'ZZ')).status, 400);
    assert.equal((await patch('bob', 'PE')).status, 403);
    assert.equal((await patch('edit', 'PE')).status, 200);
    assert.equal((await prisma.user.findUnique({ where: { id: ids.cam } })).residenceCountry, 'PE');
  });

  test('Bitget no se activa sin UID ni tipo de cambio; el administrador de edición no lo configura', async () => {
    assert.equal((await api('edit').get('/api/admin/bitget-settings')).status, 403);
    assert.equal((await api('admin').put('/api/admin/bitget-settings', { uid: 'abc' })).status, 400);
    const missing = await api('admin').put('/api/admin/bitget-settings', { enabled: true });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /UID/);
    const currencies = (await prisma.productOffer.findMany({ where: { active: true }, select: { currency: true }, distinct: ['currency'] })).map((r) => r.currency.toUpperCase());
    const rates = Object.fromEntries(currencies.filter((c) => !['USD', 'USDT'].includes(c)).map((c) => [c, 0.05]));
    const ok = await api('admin').put('/api/admin/bitget-settings', { uid: QLC_UID, instructions: 'Transfiere USDT por Transferencia interna', rates, enabled: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.enabled, true);
    assert.deepEqual(ok.body.missing, []);
  });

  test('Wallet: exige red correcta, entrega QR y acepta el hash como comprobante', async () => {
    const ADDRESS = '9i9gD2LFJ5TnfrFAY3rACnE3GWgqjkrWLXj3NyVEHbD';
    const start = await api('admin').get('/api/admin/bitget-settings');
    assert.equal(start.body.walletAddress, ADDRESS);
    assert.equal(start.body.walletNetwork, '');
    const hidden = await checkout('bob', 'BITGET');
    assert.equal(hidden.body.checkout.wallet, null);
    const wrong = await api('admin').put('/api/admin/bitget-settings', { walletNetwork: 'TRC20' });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /no corresponde a la red/);
    assert.equal((await api('admin').put('/api/admin/bitget-settings', { walletNetwork: 'INVENTADA' })).status, 400);
    assert.equal((await api('edit').put('/api/admin/bitget-settings', { walletNetwork: 'SOL' })).status, 403);
    assert.equal((await api('admin').put('/api/admin/bitget-settings', { walletNetwork: 'SOL' })).status, 200);
    const { body } = await checkout('bob', 'BITGET');
    assert.equal(body.checkout.wallet.address, ADDRESS);
    assert.equal(body.checkout.wallet.network, 'Solana (SPL)');
    assert.match(body.checkout.wallet.qr, /^data:image\/png;base64,/);
    assert.equal((await api('bob').get('/api/payments/access')).body.bitget.wallet.address, ADDRESS);
    const url = `/api/payments/attempts/${body.attempt.id}/bitget-report`;
    assert.match((await report('bob', url, { orderNumber: ADDRESS })).body.error, /dirección de wallet de QLC/);
    const hash = `${uid}${'A'.repeat(88 - uid.length)}`;
    const ok = await report('bob', url, { orderNumber: hash });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.orderNumber, hash);
  });

  test('Mercado Pago solo se ofrece a quien reside en México; Bitget a todas', async () => {
    const { encryptSecret } = await import('../src/utils/crypto.js');
    await prisma.appSetting.create({ data: { key: 'mercadopago', value: { enabled: true, publicKey: 'APP_USR-public', encryptedToken: encryptSecret('APP_USR-token'), encryptedWebhookSecret: encryptSecret('s'), account: { siteId: 'MLM' }, rates: { USD: 18, USDT: 18 }, lastTest: { ok: true } } } });
    await resetCaches();
    const mx = await api('ana').get('/api/payments/access');
    assert.deepEqual(mx.body.providers, ['MERCADOPAGO', 'BITGET']);
    assert.equal(mx.body.bitget.uid, QLC_UID);
    const us = await api('bob').get('/api/payments/access');
    assert.deepEqual(us.body.providers, ['BITGET']);
    assert.equal(us.body.charge, null);
    assert.equal((await checkout('bob', 'MERCADOPAGO')).status, 409);
    const realFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 201, json: async () => ({ id: `pref-${uid}`, init_point: 'https://mp.test/pagar' }) });
    const card = await checkout('ana', 'MERCADOPAGO');
    global.fetch = realFetch;
    assert.equal(card.status, 201);
    assert.equal(card.body.checkout.mode, 'REDIRECT');
    const sim = await checkout('bob');
    assert.equal(sim.body.attempt.provider, 'BITGET');
    assert.equal((await api('bob').post(`/api/payments/attempts/${sim.body.attempt.id}/simulate`, { outcome: 'APPROVED' })).status, 403);
  });

  test('Bitget cobra en USDT con el tipo de cambio y muestra el UID de QLC', async () => {
    const res = await checkout('bob', 'BITGET');
    assert.equal(res.status, 201);
    assert.equal(res.body.checkout.mode, 'BITGET');
    assert.equal(res.body.checkout.uid, QLC_UID);
    assert.equal(res.body.attempt.chargedAmount, 50);
    assert.equal(res.body.attempt.chargedCurrency, 'USDT');
  });

  test('Revisiones automáticas al enviar el reporte', async () => {
    const { body } = await checkout('bob', 'BITGET');
    const url = `/api/payments/attempts/${body.attempt.id}/bitget-report`;
    assert.match((await report('bob', url, { orderNumber: QLC_UID })).body.error, /UID de QLC/);
    assert.match((await report('bob', url, { orderNumber: nextOrder(), transferredAt: new Date(Date.now() + 20 * 60000).toISOString() })).body.error, /futuro/);
    assert.equal((await report('bob', url, { orderNumber: nextOrder(), transferredAt: new Date(Date.now() + 5 * 60000).toISOString(), files: [] })).status, 400);
    assert.match((await report('bob', url, { orderNumber: nextOrder(), files: [['falso.png', FAKE]] })).body.error, /no es una imagen o PDF válido/);
    assert.match((await report('bob', url, { orderNumber: nextOrder(), files: [['vacio.png', Buffer.alloc(0)]] })).body.error, /vacío|evidencia/);
    const six = Array.from({ length: 6 }, (_, i) => [`f${i}.png`, PNG]);
    assert.match((await report('bob', url, { orderNumber: nextOrder(), files: six })).body.error, /5 archivos/);
    assert.match((await report('bob', url, { orderNumber: nextOrder(), files: [['grande.pdf', Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)])]] })).body.error, /5 MB/);
    assert.equal(await prisma.bitgetReport.count({ where: { paymentAttemptId: body.attempt.id } }), 0);
    assert.equal((await report('ana', url, { orderNumber: nextOrder() })).status, 404);
  });

  test('Reporte válido: evidencias en Drive con su nombre, aviso al administrador y nada de la foto en la base', async () => {
    const { body } = await checkout('bob', 'BITGET');
    const orderNumber = nextOrder();
    const res = await report('bob', `/api/payments/attempts/${body.attempt.id}/bitget-report`, { orderNumber, files: [['pago.png', PNG], ['recibo.pdf', PDF]] });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'PENDING');
    assert.equal(res.body.files.length, 2);
    assert.equal(res.body.files[1].mimeType, 'application/pdf');
    const stored = await prisma.bitgetEvidence.findMany({ where: { reportId: res.body.id } });
    assert.ok(stored.every((f) => drive.get(f.driveFileId)?.name.startsWith(`Evidencia_${orderNumber}_`)));
    assert.ok(stored.every((f) => drive.get(f.driveFileId).parentId === `folder-${ids.bob}`));
    assert.equal(res.body.files[0].driveFileId, undefined);
    assert.ok(await prisma.adminEvent.findFirst({ where: { type: 'BITGET_REPORTADA', userId: ids.bob } }));
    assert.equal((await report('bob', `/api/payments/attempts/${body.attempt.id}/bitget-report`, { orderNumber: nextOrder() })).status, 409);
  });

  test('Un N.º de orden no se repite, ni con dos envíos al mismo tiempo', async () => {
    const orderNumber = nextOrder();
    const [a, b] = await Promise.all([checkout('bob', 'BITGET'), checkout('ana', 'BITGET')]);
    const results = await Promise.all([
      report('bob', `/api/payments/attempts/${a.body.attempt.id}/bitget-report`, { orderNumber }),
      report('ana', `/api/payments/attempts/${b.body.attempt.id}/bitget-report`, { orderNumber }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await prisma.bitgetReport.count({ where: { orderNumber } }), 1);
    const loser = results.find((r) => r.status === 409);
    assert.match(loser.body.error, /ya se reportó/);
  });

  test('Si falla la subida a Drive no queda reporte ni archivos sueltos', async () => {
    const { body } = await checkout('bob', 'BITGET');
    const before = drive.size;
    failUploadsAfter = uploads + 1;
    const res = await report('bob', `/api/payments/attempts/${body.attempt.id}/bitget-report`, { orderNumber: nextOrder(), files: [['a.png', PNG], ['b.png', PNG]] });
    failUploadsAfter = Infinity;
    assert.equal(res.status, 502);
    assert.equal(drive.size, before);
    assert.equal(await prisma.bitgetReport.count({ where: { paymentAttemptId: body.attempt.id } }), 0);
  });

  test('Administrador: recibida, luego confirmar; activa el acceso y ya no se puede eliminar', async () => {
    const { body } = await checkout('bob', 'BITGET');
    const created = await report('bob', `/api/payments/attempts/${body.attempt.id}/bitget-report`, { orderNumber: nextOrder() });
    const id = created.body.id;
    assert.equal((await api('admin').post(`/api/admin/bitget-reports/${id}/confirm`)).status, 409);
    assert.equal((await api('edit').post(`/api/admin/bitget-reports/${id}/received`)).body.status, 'REVIEW');
    assert.equal((await api('edit').post(`/api/admin/bitget-reports/${id}/confirm`)).status, 403);
    assert.equal((await report('bob', `/api/payments/bitget/reports/${id}`, { orderNumber: nextOrder(), method: 'put' })).status, 409);
    const confirmed = await api('admin').post(`/api/admin/bitget-reports/${id}/confirm`);
    assert.equal(confirmed.body.status, 'CONFIRMED');
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id: body.attempt.id } })).status, 'APPROVED');
    assert.ok(await prisma.accessGrant.findFirst({ where: { paymentAttemptId: body.attempt.id, active: true } }));
    assert.equal((await api('admin').del(`/api/admin/bitget-reports/${id}`)).status, 409);
    assert.equal((await api('admin').post(`/api/admin/bitget-reports/${id}/confirm`)).status, 409);
  });

  test('Rechazo con motivo y corrección del mismo reporte, quitando y agregando archivos', async () => {
    const { body } = await checkout('bob', 'BITGET');
    const first = nextOrder();
    const created = await report('bob', `/api/payments/attempts/${body.attempt.id}/bitget-report`, { orderNumber: first, files: [['uno.png', PNG], ['dos.png', PNG]] });
    const id = created.body.id;
    assert.equal((await api('bob').post(`/api/payments/bitget/reports/${id}/hide`)).status, 409);
    const rejected = await api('edit').post(`/api/admin/bitget-reports/${id}/reject`, { reason: 'El monto no coincide' });
    assert.equal(rejected.body.status, 'REJECTED');
    const mine = await api('bob').get('/api/payments/bitget');
    assert.equal(mine.body.reports.find((r) => r.id === id).rejectReason, 'El monto no coincide');

    const removed = created.body.files[0];
    const removedDriveId = (await prisma.bitgetEvidence.findUnique({ where: { id: removed.id } })).driveFileId;
    assert.equal((await report('bob', `/api/payments/bitget/reports/${id}`, { orderNumber: first, files: [], removeFileIds: created.body.files.map((f) => f.id), method: 'put' })).status, 400);
    const fixed = await report('bob', `/api/payments/bitget/reports/${id}`, { orderNumber: first, files: [['tres.pdf', PDF]], removeFileIds: [removed.id], method: 'put' });
    assert.equal(fixed.status, 200);
    assert.equal(fixed.body.status, 'PENDING');
    assert.equal(fixed.body.rejectReason, null);
    assert.deepEqual(fixed.body.files.map((f) => f.name).sort(), ['dos.png', 'tres.pdf']);
    assert.equal(drive.has(removedDriveId), false);
    assert.equal(await prisma.bitgetReport.count({ where: { paymentAttemptId: body.attempt.id } }), 1);
  });

  test('Un N.º de orden rechazado se puede volver a usar', async () => {
    const a = await checkout('bob', 'BITGET');
    const orderNumber = nextOrder();
    const created = await report('bob', `/api/payments/attempts/${a.body.attempt.id}/bitget-report`, { orderNumber });
    await api('edit').post(`/api/admin/bitget-reports/${created.body.id}/reject`, {});
    const b = await checkout('ana', 'BITGET');
    assert.equal((await report('ana', `/api/payments/attempts/${b.body.attempt.id}/bitget-report`, { orderNumber })).status, 201);
    assert.equal((await report('bob', `/api/payments/bitget/reports/${created.body.id}`, { orderNumber, method: 'put' })).status, 409);
  });

  test('Ver evidencia: solo el dueño y el administrador, siempre a través del servidor', async () => {
    const { body } = await checkout('bob', 'BITGET');
    const created = await report('bob', `/api/payments/attempts/${body.attempt.id}/bitget-report`, { orderNumber: nextOrder() });
    const fileId = created.body.files[0].id;
    const own = await api('bob').get(`/api/payments/bitget/files/${fileId}`);
    assert.equal(own.status, 200);
    assert.equal(own.headers['content-type'], 'image/png');
    assert.equal((await api('ana').get(`/api/payments/bitget/files/${fileId}`)).status, 404);
    assert.equal((await api('admin').get(`/api/admin/bitget-files/${fileId}`)).status, 200);
    assert.equal((await request(app).get(`/api/payments/bitget/files/${fileId}`)).status, 401);
  });

  test('Borrar del historial solo oculta; eliminar un reporte pendiente borra sus archivos y permite enviar otro', async () => {
    const { body } = await checkout('bob', 'BITGET');
    const created = await report('bob', `/api/payments/attempts/${body.attempt.id}/bitget-report`, { orderNumber: nextOrder() });
    const driveId = (await prisma.bitgetEvidence.findFirst({ where: { reportId: created.body.id } })).driveFileId;
    assert.equal((await api('edit').del(`/api/admin/bitget-reports/${created.body.id}`)).status, 403);
    assert.equal((await api('admin').del(`/api/admin/bitget-reports/${created.body.id}`)).status, 200);
    assert.equal(drive.has(driveId), false);
    assert.equal((await prisma.paymentAttempt.findUnique({ where: { id: body.attempt.id } })).status, 'PENDING');
    const overview = await api('bob').get('/api/payments/bitget');
    assert.ok(overview.body.pending.some((p) => p.id === body.attempt.id));
    const again = await report('bob', `/api/payments/attempts/${body.attempt.id}/bitget-report`, { orderNumber: nextOrder() });
    assert.equal(again.status, 201);

    await api('edit').post(`/api/admin/bitget-reports/${again.body.id}/reject`, {});
    assert.equal((await api('bob').post(`/api/payments/bitget/reports/${again.body.id}/hide`)).status, 200);
    assert.equal((await api('bob').get('/api/payments/bitget')).body.reports.some((r) => r.id === again.body.id), false);
    assert.ok(await prisma.bitgetReport.findUnique({ where: { id: again.body.id } }));
    assert.ok((await api('admin').get('/api/admin/bitget-reports')).body.rows.some((r) => r.id === again.body.id));
  });

  test('Renovación por Bitget: aviso por correo antes de vencer en productos mensuales o anuales', async () => {
    const { sendRenewalReminders } = await import('../src/services/subscriber.service.js');
    await prisma.productOffer.update({ where: { id: offer.id }, data: { billingCycle: 'YEARLY' } });
    const attempt = await prisma.paymentAttempt.create({ data: { userId: ids.cam, offerId: offer.id, provider: 'BITGET', amount: 1000, currency: 'MXN', chargedAmount: 50, chargedCurrency: 'USDT', status: 'APPROVED' } });
    await prisma.accessGrant.create({ data: { userId: ids.cam, offerId: offer.id, paymentAttemptId: attempt.id, accessType: 'FULL_ANNUAL', startsAt: new Date(Date.now() - 86400000), expiresAt: new Date(Date.now() + 2 * 86400000) } });
    const sent = [];
    await sendRenewalReminders(new Date(), async (type, template, to) => {
      sent.push({ type, template, to });
      return { sent: true };
    });
    assert.ok(sent.some((m) => m.to === `cam-${uid}@test.qlc` && m.template === 'renewalDue'));
    await prisma.productOffer.update({ where: { id: offer.id }, data: { billingCycle: null } });
  });
});

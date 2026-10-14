// Pruebas de integración contra una base PostgreSQL de PRUEBAS (nunca producción).
// Se ejecutan solo si existe TEST_DATABASE_URL; la base debe tener las migraciones aplicadas.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

run('API (integración)', () => {
  let app, prisma, processNotification;
  const uid = Date.now().toString(36);
  const tokens = {};
  const ids = {};

  const api = (who) => {
    const auth = (r) => r.set('Authorization', `Bearer ${tokens[who]}`);
    return {
      get: (url, h = {}) => auth(request(app).get(url)).set(h),
      post: (url, body, h = {}) => auth(request(app).post(url)).set(h).send(body),
      put: (url, body, h = {}) => auth(request(app).put(url)).set(h).send(body),
      patch: (url, body, h = {}) => auth(request(app).patch(url)).set(h).send(body),
    };
  };

  async function register(key) {
    const res = await request(app).post('/api/auth/register').send({ name: `Cliente ${key}`, email: `${key}-${uid}@test.qlc`, password: 'Password123!' });
    assert.equal(res.status, 201);
    tokens[key] = res.body.token;
    ids[key] = res.body.user.id;
  }

  async function createAdmin(key, adminLevel) {
    const email = `${key}-${uid}@admin.qlc`;
    await prisma.user.create({ data: { email, name: key, role: 'ADMIN', adminLevel, passwordHash: await bcrypt.hash('AdminPass123!', 4) } });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'AdminPass123!' });
    tokens[key] = res.body.token;
  }

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.NODE_ENV = 'test';
    ({ createApp: app } = await import('../src/app.js'));
    app = app();
    ({ prisma } = await import('../src/config/prisma.js'));
    ({ processNotification } = await import('../src/services/subscription.service.js'));
    await register('a');
    await register('b');
    await createAdmin('full', 'FULL');
    await createAdmin('view', 'VIEW');
    await createAdmin('edit', 'EDIT');
  });

  after(async () => prisma?.$disconnect());

  test('Sin membresía activa no hay acceso privado (403)', async () => {
    const res = await api('a').get('/api/dashboard');
    assert.equal(res.status, 403);
    assert.equal((await request(app).get('/api/dashboard')).status, 401);
  });

  test('Webhook repetido es idempotente y activa la membresía una sola vez', async () => {
    await prisma.subscription.create({ data: { userId: ids.a, plan: 'MONTHLY', amount: 1, currency: 'MXN', mpPreapprovalId: `pre-${uid}` } });
    const fetcher = async (path) => {
      if (path.startsWith('/v1/payments/')) {
        return { id: `pay-${uid}`, status: 'approved', transaction_amount: 1, currency_id: 'MXN', external_reference: ids.a, date_approved: new Date().toISOString(), metadata: { preapproval_id: `pre-${uid}` } };
      }
      throw new Error('no esperado');
    };
    const first = await processNotification({ topic: 'payment', dataId: `pay-${uid}`, eventId: 'evt-1' }, { fetcher });
    const again = await processNotification({ topic: 'payment', dataId: `pay-${uid}`, eventId: 'evt-1' }, { fetcher });
    const retry = await processNotification({ topic: 'payment', dataId: `pay-${uid}`, eventId: 'evt-2' }, { fetcher });
    assert.deepEqual(first, { processed: true });
    assert.deepEqual(again, { duplicate: true });
    assert.deepEqual(retry, { processed: true });
    assert.equal(await prisma.payment.count({ where: { userId: ids.a } }), 1);
    const sub = await prisma.subscription.findUnique({ where: { userId: ids.a } });
    assert.equal(sub.status, 'ACTIVE');
    assert.ok(sub.activatedAt);
    assert.equal((await api('a').get('/api/dashboard')).status, 200);
  });

  test('Cliente registra periodo, cartera y movimientos; resumen conciliado', async () => {
    const p = await api('a').post('/api/periods', { year: 2026, month: 1, openingNetWorth: 1000000 });
    assert.equal(p.status, 201);
    ids.period = p.body.id;
    const cats = await api('a').get('/api/portfolio/categories');
    assert.equal(cats.body.length, 6);
    const pos = await api('a').post('/api/portfolio/positions', { periodId: ids.period, categoryCode: 'RENTA_FIJA', name: 'CETES', initialCapital: 1050000, finalCapital: 1080000 });
    assert.equal(pos.status, 201);
    ids.position = pos.body.id;
    await api('a').post('/api/patrimonial-movements', { periodId: ids.period, type: 'APORTACION', amount: 100000, date: '2026-01-10', description: 'Caja de ahorro' });
    const m2 = await api('a').post('/api/patrimonial-movements', { periodId: ids.period, type: 'DEDUCCION', amount: 50000, date: '2026-01-20', description: 'Retiro CETES' });
    assert.equal(m2.status, 201);
    const s = await api('a').get(`/api/periods/${ids.period}/summary`);
    assert.equal(s.body.summary.patrimony.final, 1080000);
    assert.equal(s.body.summary.patrimony.profitability, 30000);
    assert.equal(s.body.summary.reconciliation.reconciled, true);
  });

  test('Validación de inputs: montos negativos rechazados', async () => {
    const res = await api('a').post('/api/incomes', { periodId: ids.period, category: 'SALARIO', description: 'x', amount: -5 });
    assert.equal(res.status, 400);
  });

  test('Usuario no puede acceder a datos ajenos (ni con X-Client-Id)', async () => {
    await prisma.subscription.create({ data: { userId: ids.b, plan: 'MONTHLY', amount: 1, currency: 'MXN', status: 'ACTIVE', activatedAt: new Date(), nextBillingDate: new Date(Date.now() + 864e5 * 30) } });
    assert.equal((await api('b').get(`/api/periods/${ids.period}/summary`)).status, 404);
    assert.equal((await api('b').get(`/api/periods/${ids.period}/summary`, { 'X-Client-Id': ids.a })).status, 404);
    const del = await request(app).delete(`/api/portfolio/positions/${ids.position}`).set('Authorization', `Bearer ${tokens.b}`);
    assert.equal(del.status, 404);
    assert.equal((await api('b').get('/api/admin/clients')).status, 403);
  });

  test('Admin VIEW consulta pero no modifica; admin EDIT modifica con trazabilidad', async () => {
    const h = { 'X-Client-Id': ids.a };
    assert.equal((await api('view').get(`/api/periods/${ids.period}/summary`, h)).status, 200);
    const body = { periodId: ids.period, categoryCode: 'RENTA_FIJA', name: 'CETES', initialCapital: 1050000, finalCapital: 1080000 };
    assert.equal((await api('view').put(`/api/portfolio/positions/${ids.position}`, { ...body, finalCapital: 1 }, h)).status, 403);
    const upd = await api('edit').put(`/api/portfolio/positions/${ids.position}`, { ...body, finalCapital: 1085000 }, h);
    assert.equal(upd.status, 200);
    const log = await prisma.adminAuditLog.findFirst({ where: { clientId: ids.a, field: 'finalCapital' } });
    assert.equal(log.oldValue, '1080000');
    assert.equal(log.newValue, '1085000');
    assert.equal(log.module, 'CARTERA');
    // El cliente ve la cifra recalculada (misma fuente de datos, sin copia del admin).
    let s = await api('a').get(`/api/periods/${ids.period}/summary`);
    assert.equal(s.body.summary.patrimony.final, 1085000);
    assert.equal(s.body.summary.patrimony.profitability, 35000);
    assert.equal(s.body.summary.reconciliation.reconciled, true);
    // Un capital inicial que no corresponde a inicial + movimientos → no conciliado.
    await api('edit').put(`/api/portfolio/positions/${ids.position}`, { ...body, initialCapital: 1060000 }, h);
    s = await api('a').get(`/api/periods/${ids.period}/summary`);
    assert.equal(s.body.summary.reconciliation.reconciled, false);
    assert.equal(s.body.summary.reconciliation.difference, 10000);
    await api('edit').put(`/api/portfolio/positions/${ids.position}`, body, h);
  });

  test('Cierre mensual guarda snapshot, bloquea ediciones y el siguiente periodo arrastra el final', async () => {
    const close = await api('a').post(`/api/periods/${ids.period}/close`, {});
    assert.equal(close.status, 201);
    assert.equal(close.body.snapshot.patrimony.final, 1080000);
    const blocked = await api('a').post('/api/incomes', { periodId: ids.period, category: 'SALARIO', description: 'x', amount: 5 });
    assert.equal(blocked.status, 409);
    const next = await api('a').post('/api/periods', { year: 2026, month: 2 });
    const s = await api('a').get(`/api/periods/${next.body.id}/summary`);
    assert.equal(s.body.summary.patrimony.opening, 1080000);
    assert.equal(s.body.summary.portfolio.global.initial, 1080000);
    assert.equal(s.body.summary.reconciliation.reconciled, true);
    const pdf = await api('a').get(`/api/monthly-closes/${close.body.id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal((await api('a').post(`/api/periods/${ids.period}/reopen`, { reason: 'x' })).status, 403);
    const annual = await api('a').post('/api/annual-reports/2026/generate', {});
    assert.equal(annual.status, 201);
    assert.equal(annual.body.snapshot.monthsClosed, 1);
  });

  test('Academia: módulo 1 disponible, módulo 2 bloqueado en backend', async () => {
    assert.equal((await api('a').get('/api/academy/modules/1')).status, 200);
    assert.equal((await api('a').get('/api/academy/modules/2')).status, 403);
    assert.equal((await api('a').post('/api/academy/tools/rendimiento-neto', { input: { capital: 1, returnRate: 1 } })).status, 403);
  });

  test('Suscripción cancelada bloquea acceso y conserva datos', async () => {
    await api('full').patch(`/api/admin/clients/${ids.a}/subscription`, { status: 'CANCELLED', reason: 'Prueba' });
    assert.equal((await api('a').get('/api/dashboard')).status, 403);
    assert.ok((await prisma.assetPosition.count({ where: { asset: { userId: ids.a } } })) > 0);
    assert.equal((await api('edit').patch(`/api/admin/clients/${ids.a}/subscription`, { status: 'ACTIVE', reason: 'x' })).status, 403);
  });
});

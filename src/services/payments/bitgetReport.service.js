import { prisma } from '../../config/prisma.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../../utils/httpError.js';
import { num } from '../../utils/money.js';
import { detectEvidenceType, EVIDENCE_MAX_BYTES, EVIDENCE_MAX_FILES } from '../../utils/fileSignature.js';
import { actorOf, recordEvent } from '../adminEvent.service.js';
import { sendClientEmail } from '../email.service.js';
import * as drive from '../google/drive.js';
import { bitgetSettings, publicBitgetInfo } from './bitgetSettings.service.js';
import { resolveAttempt } from './payment.service.js';

export const REPORT_STATUS = { PENDING: 'Pendiente', REVIEW: 'En revisión', CONFIRMED: 'Confirmado', REJECTED: 'Rechazado' };
const FUTURE_TOLERANCE_MS = 10 * 60000;
const ORDER_PATTERN = /^[A-Za-z0-9-]{4,128}$/;
const DRIVE_SECTION = 'Pagos';

export const storage = {
  connected: () => drive.driveConnected(),
  folder: (user) => drive.ensureClientFolder(user, DRIVE_SECTION),
  upload: (meta) => drive.uploadBuffer(meta),
  remove: (id) => drive.deleteFile(id),
  stream: (id, range, res) => drive.streamFile(id, range, res),
};

const digits = (value) => String(value || '').replace(/\D/g, '');

const fileView = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, createdAt: f.createdAt });

const reportView = (r) => ({
  id: r.id,
  status: r.status,
  statusLabel: REPORT_STATUS[r.status] || r.status,
  orderNumber: r.orderNumber,
  transferredAt: r.transferredAt,
  rejectReason: r.rejectReason,
  receivedAt: r.receivedAt,
  resolvedAt: r.resolvedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  files: (r.files || []).map(fileView),
  attempt: r.attempt ? {
    id: r.attempt.id,
    status: r.attempt.status,
    kind: r.attempt.kind,
    quantity: r.attempt.quantity,
    amount: r.attempt.chargedAmount === null ? null : num(r.attempt.chargedAmount),
    currency: r.attempt.chargedCurrency,
    product: r.attempt.offer?.name || null,
  } : null,
  user: r.user ? { id: r.user.id, name: r.user.name, email: r.user.email } : undefined,
});

const INCLUDE = { files: { orderBy: { createdAt: 'asc' } }, attempt: { include: { offer: true } } };

function parseFields({ orderNumber, transferredAt }, settings, now = new Date()) {
  const order = String(orderNumber || '').trim();
  if (!ORDER_PATTERN.test(order)) throw badRequest('Escribe el N.º de orden de Bitget o el hash de la transacción (solo letras, números o guiones).');
  if (settings.uid && digits(order) && digits(order) === digits(settings.uid)) throw badRequest('Ese número es el UID de QLC, no el N.º de orden. Copia el N.º de orden que aparece en tu historial de Bitget.');
  if (settings.walletAddress && order === settings.walletAddress) throw badRequest('Esa es la dirección de wallet de QLC, no tu comprobante. Copia el N.º de orden o el hash de tu transacción.');
  const when = new Date(transferredAt);
  if (!transferredAt || Number.isNaN(when.getTime())) throw badRequest('Indica la fecha y hora de la transferencia.');
  if (when.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) throw badRequest('La fecha y hora de la transferencia no puede estar en el futuro.');
  return { orderNumber: order, transferredAt: when };
}

function checkFiles(files, { existing = 0, required = true } = {}) {
  const list = files || [];
  const total = existing + list.length;
  if (required && total < 1) throw badRequest('Agrega al menos un archivo de evidencia.');
  if (total > EVIDENCE_MAX_FILES) throw badRequest(`Puedes adjuntar como máximo ${EVIDENCE_MAX_FILES} archivos.`);
  return list.map((file) => {
    if (!file.size || !file.buffer?.length) throw badRequest(`El archivo "${file.originalname}" está vacío.`);
    if (file.size > EVIDENCE_MAX_BYTES) throw badRequest(`El archivo "${file.originalname}" pesa más de 5 MB.`);
    const mimeType = detectEvidenceType(file.buffer);
    if (!mimeType) throw badRequest(`El archivo "${file.originalname}" no es una imagen o PDF válido.`);
    return { buffer: file.buffer, size: file.size, mimeType, original: String(file.originalname || 'archivo').slice(0, 150) };
  });
}

const evidenceName = (order, original) => `Evidencia_${order}_${original}`.replace(/[\\/]+/g, '_').slice(0, 200);

async function uploadAll(user, orderNumber, files) {
  if (!files.length) return [];
  const parentId = await storage.folder(user);
  const uploaded = [];
  try {
    for (const file of files) {
      const result = await storage.upload({ name: evidenceName(orderNumber, file.original), mimeType: file.mimeType, buffer: file.buffer, parentId });
      uploaded.push({ name: file.original, mimeType: file.mimeType, size: file.size, driveFileId: result.id });
    }
  } catch (err) {
    for (const u of uploaded) await storage.remove(u.driveFileId).catch(() => null);
    throw err;
  }
  return uploaded;
}

const duplicateOrder = (err) => err?.code === 'P2002' && String(err?.meta?.target || '').includes('orderNumber');

const orderConflict = () => conflict('Ese N.º de orden ya se reportó. Si es un error, revisa tu historial en Mi acceso.');

async function assertStorage() {
  if (!(await storage.connected())) throw new HttpError(503, 'Por ahora no podemos recibir comprobantes. Intenta más tarde.');
}

async function ownedBitgetAttempt(user, attemptId) {
  const attempt = await prisma.paymentAttempt.findUnique({ where: { id: attemptId }, include: { offer: true, bitgetReport: true } });
  if (!attempt || attempt.userId !== user.id) throw notFound('Intento de pago no encontrado');
  if (attempt.provider !== 'BITGET') throw forbidden('Este pago no se hace por transferencia Bitget');
  if (attempt.status !== 'PENDING') throw conflict('Este pago ya fue resuelto. Revisa tu historial en Mi acceso.');
  if (attempt.bitgetReport) throw conflict('Ya reportaste esta transferencia. Si necesitas cambiar algo, usa Corregir reporte en Mi acceso.');
  return attempt;
}

export async function submitReport(user, attemptId, body, files) {
  const attempt = await ownedBitgetAttempt(user, attemptId);
  const settings = await bitgetSettings();
  const fields = parseFields(body, settings);
  const prepared = checkFiles(files);
  await assertStorage();
  let report;
  try {
    report = await prisma.bitgetReport.create({ data: { userId: user.id, paymentAttemptId: attempt.id, ...fields } });
  } catch (err) {
    if (duplicateOrder(err)) throw orderConflict();
    if (err?.code === 'P2002') throw conflict('Ya reportaste esta transferencia.');
    throw err;
  }
  let uploaded;
  try {
    uploaded = await uploadAll(user, fields.orderNumber, prepared);
  } catch (err) {
    await prisma.bitgetReport.delete({ where: { id: report.id } }).catch(() => null);
    console.error('[bitget] no se pudo subir la evidencia:', err.message);
    throw new HttpError(502, 'No pudimos guardar tus archivos. No se registró el reporte; intenta de nuevo.');
  }
  await prisma.bitgetEvidence.createMany({ data: uploaded.map((u) => ({ ...u, reportId: report.id })) });
  await recordEvent({
    category: 'SUSCRIPCION', type: 'BITGET_REPORTADA', actor: actorOf(user), user, offer: attempt.offer, status: 'Pendiente de revisión',
    amount: attempt.amount, result: `N.º de orden ${fields.orderNumber} · ${num(attempt.chargedAmount)} ${attempt.chargedCurrency}`,
  });
  return reportView(await prisma.bitgetReport.findUnique({ where: { id: report.id }, include: INCLUDE }));
}

async function ownedReport(user, reportId) {
  const report = await prisma.bitgetReport.findUnique({ where: { id: reportId }, include: { ...INCLUDE, user: true } });
  if (!report || report.userId !== user.id) throw notFound('Reporte no encontrado');
  return report;
}

export async function correctReport(user, reportId, body, files) {
  const report = await ownedReport(user, reportId);
  if (!['PENDING', 'REJECTED'].includes(report.status)) throw conflict('Este reporte ya está en revisión o confirmado; no se puede corregir.');
  const settings = await bitgetSettings();
  const fields = parseFields(body, settings);
  const removeIds = new Set([].concat(body.removeFileIds || []).map(String));
  const kept = report.files.filter((f) => !removeIds.has(f.id));
  const prepared = checkFiles(files, { existing: kept.length });
  if (prepared.length) await assertStorage();
  const previous = { orderNumber: report.orderNumber, transferredAt: report.transferredAt, status: report.status, rejectReason: report.rejectReason };
  const claimed = await prisma.bitgetReport.updateMany({
    where: { id: report.id, status: report.status },
    data: { ...fields, status: 'PENDING', rejectReason: null, receivedAt: null, receivedById: null, resolvedAt: null, resolvedById: null },
  }).catch((err) => {
    if (duplicateOrder(err)) throw orderConflict();
    throw err;
  });
  if (!claimed.count) throw conflict('El reporte cambió mientras lo corregías. Recarga la página.');
  let uploaded;
  try {
    uploaded = await uploadAll(report.user, fields.orderNumber, prepared);
  } catch (err) {
    await prisma.bitgetReport.update({ where: { id: report.id }, data: previous }).catch(() => null);
    console.error('[bitget] no se pudo subir la evidencia:', err.message);
    throw new HttpError(502, 'No pudimos guardar tus archivos. Tu reporte no cambió; intenta de nuevo.');
  }
  if (uploaded.length) await prisma.bitgetEvidence.createMany({ data: uploaded.map((u) => ({ ...u, reportId: report.id })) });
  const removed = report.files.filter((f) => removeIds.has(f.id));
  if (removed.length) {
    await prisma.bitgetEvidence.deleteMany({ where: { id: { in: removed.map((f) => f.id) }, reportId: report.id } });
    for (const f of removed) await storage.remove(f.driveFileId).catch((err) => console.error('[bitget] no se pudo borrar de Drive:', err.message));
  }
  await recordEvent({
    category: 'SUSCRIPCION', type: 'BITGET_REPORTADA', actor: actorOf(user), user: report.user, offer: report.attempt.offer, status: 'Reporte corregido · pendiente de revisión',
    amount: report.attempt.amount, result: `N.º de orden ${fields.orderNumber}`,
  });
  return reportView(await prisma.bitgetReport.findUnique({ where: { id: report.id }, include: INCLUDE }));
}

export async function clientOverview(user) {
  const [reports, pending, info] = await Promise.all([
    prisma.bitgetReport.findMany({ where: { userId: user.id, hiddenForClient: false }, include: INCLUDE, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.paymentAttempt.findMany({ where: { userId: user.id, provider: 'BITGET', status: 'PENDING', bitgetReport: null }, include: { offer: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
    publicBitgetInfo(),
  ]);
  return {
    info,
    reports: reports.map(reportView),
    pending: pending.map((a) => ({ id: a.id, product: a.offer.name, amount: a.chargedAmount === null ? null : num(a.chargedAmount), currency: a.chargedCurrency, createdAt: a.createdAt })),
  };
}

export async function hideReport(actor, reportId) {
  const report = await prisma.bitgetReport.findUnique({ where: { id: reportId } });
  const isAdmin = actor.role === 'ADMIN';
  if (!report || (!isAdmin && report.userId !== actor.id)) throw notFound('Reporte no encontrado');
  if (!['CONFIRMED', 'REJECTED'].includes(report.status)) throw conflict('Solo puedes borrar del historial reportes confirmados o rechazados.');
  await prisma.bitgetReport.update({ where: { id: report.id }, data: isAdmin ? { hiddenForAdmin: true } : { hiddenForClient: true } });
  return { ok: true };
}

export async function adminReports({ status } = {}) {
  const rows = await prisma.bitgetReport.findMany({
    where: { hiddenForAdmin: false, ...(status ? { status } : {}) },
    include: { ...INCLUDE, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const counts = await prisma.bitgetReport.groupBy({ by: ['status'], where: { hiddenForAdmin: false }, _count: { _all: true } });
  return { rows: rows.map(reportView), counts: Object.fromEntries(Object.keys(REPORT_STATUS).map((k) => [k, counts.find((c) => c.status === k)?._count._all || 0])) };
}

async function adminReport(id) {
  const report = await prisma.bitgetReport.findUnique({ where: { id }, include: { ...INCLUDE, user: true } });
  if (!report) throw notFound('Reporte no encontrado');
  return report;
}

async function move(admin, report, from, data) {
  const claimed = await prisma.bitgetReport.updateMany({ where: { id: report.id, status: from }, data });
  if (!claimed.count) throw conflict('El reporte cambió de estado. Recarga la página.');
}

export async function markReceived(admin, id) {
  const report = await adminReport(id);
  if (report.status !== 'PENDING') throw conflict('Solo se marca como recibida una transferencia pendiente.');
  await move(admin, report, 'PENDING', { status: 'REVIEW', receivedAt: new Date(), receivedById: admin.id });
  await recordEvent({ category: 'SUSCRIPCION', type: 'BITGET_RECIBIDA', actor: actorOf(admin), user: report.user, offer: report.attempt.offer, status: 'En revisión', amount: report.attempt.amount, result: `N.º de orden ${report.orderNumber}`, silent: true });
  return reportView(await adminReport(id));
}

export async function confirmReport(admin, id) {
  const report = await adminReport(id);
  if (report.status !== 'REVIEW') throw conflict('Primero marca la transferencia como recibida.');
  if (report.attempt.status !== 'PENDING') throw conflict('Este pago ya fue resuelto.');
  await move(admin, report, 'REVIEW', { status: 'CONFIRMED', resolvedAt: new Date(), resolvedById: admin.id });
  try {
    await resolveAttempt(report.paymentAttemptId, 'APPROVED', prisma, { paymentId: `bitget:${report.orderNumber}` });
  } catch (err) {
    await prisma.bitgetReport.update({ where: { id: report.id }, data: { status: 'REVIEW', resolvedAt: null, resolvedById: null } });
    throw err;
  }
  await recordEvent({ category: 'SUSCRIPCION', type: 'BITGET_CONFIRMADA', actor: actorOf(admin), user: report.user, offer: report.attempt.offer, status: 'Confirmado', amount: report.attempt.amount, result: `N.º de orden ${report.orderNumber}`, silent: true });
  return reportView(await adminReport(id));
}

export async function rejectReport(admin, id, reason) {
  const report = await adminReport(id);
  if (!['PENDING', 'REVIEW'].includes(report.status)) throw conflict('Este reporte ya fue resuelto.');
  const rejectReason = String(reason || '').trim().slice(0, 500) || null;
  await move(admin, report, report.status, { status: 'REJECTED', rejectReason, resolvedAt: new Date(), resolvedById: admin.id });
  await recordEvent({ category: 'SUSCRIPCION', type: 'BITGET_RECHAZADA', actor: actorOf(admin), user: report.user, offer: report.attempt.offer, status: 'Rechazado', amount: report.attempt.amount, result: rejectReason, silent: true });
  sendClientEmail('PAGO_BITGET_RECHAZADO', 'bitgetRejected', report.user.email, { name: report.user.name, product: report.attempt.offer.name, orderNumber: report.orderNumber, reason: rejectReason }).catch(() => null);
  return reportView(await adminReport(id));
}

export async function deleteReport(admin, id) {
  const report = await adminReport(id);
  if (report.status === 'CONFIRMED') throw conflict('Un pago ya confirmado no se puede eliminar.');
  for (const f of report.files) await storage.remove(f.driveFileId).catch((err) => console.error('[bitget] no se pudo borrar de Drive:', err.message));
  await prisma.bitgetReport.delete({ where: { id: report.id } });
  await recordEvent({ category: 'SUSCRIPCION', type: 'BITGET_ELIMINADA', actor: actorOf(admin), user: report.user, offer: report.attempt.offer, status: 'Reporte eliminado', amount: report.attempt.amount, result: `N.º de orden ${report.orderNumber}`, silent: true });
  return { ok: true };
}

export async function streamEvidence(user, fileId, range, res) {
  const file = await prisma.bitgetEvidence.findUnique({ where: { id: fileId }, include: { report: { select: { userId: true } } } });
  if (!file || (user.role !== 'ADMIN' && file.report.userId !== user.id)) throw notFound('Archivo no encontrado');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  await storage.stream(file.driveFileId, range, res);
}

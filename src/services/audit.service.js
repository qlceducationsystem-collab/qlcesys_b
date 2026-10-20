import { prisma } from '../config/prisma.js';
import { diffFields } from '../domain/audit.js';

const snapshot = (obj) => (obj ? JSON.stringify(obj) : null);

function auditRows(base, action, before, after) {
  if (action === 'UPDATE') return diffFields(before, after).map((c) => ({ ...base, ...c }));
  return [{ ...base, oldValue: snapshot(before), newValue: snapshot(after) }];
}

export async function logAdminChange(req, { module, action, entityId, before, after, reason, clientId }, db = prisma) {
  const target = clientId || req.subjectId;
  if (req.user?.role !== 'ADMIN' || !target || target === req.user.id) return;
  const base = { adminId: req.user.id, clientId: target, module, action, entityId: entityId || null, reason: reason || null };
  const rows = auditRows(base, action, before, after);
  if (rows.length) await db.adminAuditLog.createMany({ data: rows });
}

export async function logSystemChange(adminId, { module, action, entityId, before, after, reason }, db = prisma) {
  const rows = auditRows({ adminId, clientId: null, module, action, entityId: entityId || null, reason: reason || null }, action, before, after);
  if (rows.length) await db.adminAuditLog.createMany({ data: rows });
}

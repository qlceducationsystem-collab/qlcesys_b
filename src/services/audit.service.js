import { prisma } from '../config/prisma.js';
import { diffFields } from '../domain/audit.js';

const snapshot = (obj) => (obj ? JSON.stringify(obj) : null);

/**
 * Registra trazabilidad cuando un ADMIN modifica datos de un cliente.
 * action: CREATE | UPDATE | DELETE | otra acción administrativa.
 */
export async function logAdminChange(req, { module, action, entityId, before, after, reason, clientId }, db = prisma) {
  const target = clientId || req.subjectId;
  if (req.user?.role !== 'ADMIN' || !target || target === req.user.id) return;
  const base = { adminId: req.user.id, clientId: target, module, action, entityId: entityId || null, reason: reason || null };

  let rows;
  if (action === 'UPDATE') {
    rows = diffFields(before, after).map((c) => ({ ...base, ...c }));
  } else {
    rows = [{ ...base, oldValue: snapshot(before), newValue: snapshot(after) }];
  }
  if (rows.length) await db.adminAuditLog.createMany({ data: rows });
}

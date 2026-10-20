import { prisma } from '../config/prisma.js';
import { notFound } from '../utils/httpError.js';
import { track } from './analytics.service.js';
import { logSystemChange } from './audit.service.js';

export async function createLead({ name, email, phone, interest, message, sourcePath, sessionId }) {
  const lead = await prisma.lead.create({ data: { name, email, phone: phone || null, interest, message: message || null, sourcePath: sourcePath || null } });
  await track('LEAD_REQUEST', { sessionId, path: sourcePath, metadata: { source: interest } });
  return { id: lead.id, createdAt: lead.createdAt };
}

export async function listLeads({ status, interest } = {}) {
  const where = { ...(status ? { status } : {}), ...(interest ? { interest } : {}) };
  const [items, counts] = await Promise.all([
    prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 }),
    prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  return { items, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
}

export async function updateLead(req, id, { status, adminNotes }) {
  const before = await prisma.lead.findUnique({ where: { id } });
  if (!before) throw notFound('Solicitud no encontrada');
  const lead = await prisma.lead.update({ where: { id }, data: { status, adminNotes: adminNotes ?? before.adminNotes } });
  await logSystemChange(req.user.id, { module: 'SOLICITUDES', action: 'UPDATE', entityId: id, before: { status: before.status, adminNotes: before.adminNotes }, after: { status: lead.status, adminNotes: lead.adminNotes } });
  return lead;
}

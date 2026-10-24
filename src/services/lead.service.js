import { prisma } from '../config/prisma.js';
import { notFound } from '../utils/httpError.js';

export async function createLead({ name, email, phone, interest, message, sourcePath }) {
  const lead = await prisma.lead.create({ data: { name, email, phone: phone || null, interest, message: message || null, sourcePath: sourcePath || null } });
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

export async function updateLead(id, { status, adminNotes }) {
  const before = await prisma.lead.findUnique({ where: { id } });
  if (!before) throw notFound('Solicitud no encontrada');
  return prisma.lead.update({ where: { id }, data: { status, adminNotes: adminNotes ?? before.adminNotes } });
}

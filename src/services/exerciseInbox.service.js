import { prisma } from '../config/prisma.js';
import { notFound } from '../utils/httpError.js';

const isPending = (p) => !p.adminReplyAt || (p.exerciseAt && p.exerciseAt > p.adminReplyAt);

const view = (p) => ({
  id: p.id,
  moduleNumber: p.module.month,
  moduleTitle: p.module.title,
  user: p.user,
  exercise: p.exercise,
  exerciseAt: p.exerciseAt || p.updatedAt,
  adminReply: p.adminReply,
  adminReplyAt: p.adminReplyAt,
  pending: isPending(p),
});

export async function listExercises({ status } = {}) {
  const rows = await prisma.moduleProgress.findMany({
    where: { exercise: { not: null }, NOT: { exercise: '' } },
    orderBy: { updatedAt: 'desc' },
    take: 300,
    select: {
      id: true, exercise: true, exerciseAt: true, adminReply: true, adminReplyAt: true, updatedAt: true,
      module: { select: { month: true, title: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  const all = rows.map(view);
  const pending = all.filter((x) => x.pending).length;
  const items = status === 'PENDING' ? all.filter((x) => x.pending) : status === 'ANSWERED' ? all.filter((x) => !x.pending) : all;
  return { items, counts: { PENDING: pending, ANSWERED: all.length - pending } };
}

export async function replyExercise(id, { reply }) {
  const row = await prisma.moduleProgress.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw notFound('Registro no encontrado');
  await prisma.moduleProgress.update({ where: { id }, data: { adminReply: reply, adminReplyAt: new Date() } });
  return { ok: true };
}

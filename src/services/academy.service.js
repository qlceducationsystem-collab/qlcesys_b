import { prisma } from '../config/prisma.js';
import { addMonths, isModuleUnlocked, unlockState } from '../domain/subscription.js';
import { forbidden, notFound } from '../utils/httpError.js';

// Módulo asociado a cada herramienta de cálculo (se desbloquea con su módulo).
export const TOOL_MODULE = { 'rendimiento-neto': 10, 'poder-adquisitivo': 11 };

async function context(userId) {
  const sub = await prisma.subscription.findUnique({ where: { userId }, select: { activatedAt: true } });
  return { activatedAt: sub?.activatedAt || null };
}

const describe = (m, activatedAt, progress) => ({
  id: m.id,
  month: m.month,
  block: m.block,
  title: m.title,
  summary: m.summary,
  tool: m.content?.tool || null,
  unlocked: isModuleUnlocked(m.month, activatedAt),
  unlocksAt: activatedAt ? addMonths(activatedAt, m.month - 1) : null,
  status: progress?.status || 'NOT_STARTED',
  completedAt: progress?.completedAt || null,
});

export async function listModules(userId) {
  const { activatedAt } = await context(userId);
  const [modules, progress] = await Promise.all([
    prisma.academyModule.findMany({ orderBy: { month: 'asc' } }),
    prisma.moduleProgress.findMany({ where: { userId } }),
  ]);
  const byModule = new Map(progress.map((p) => [p.moduleId, p]));
  const items = modules.map((m) => describe(m, activatedAt, byModule.get(m.id)));
  const completed = items.filter((i) => i.status === 'COMPLETED').length;
  const state = activatedAt ? unlockState(activatedAt) : { currentMonth: 0, unlocked: 0, pending: modules.length };
  return {
    ...state,
    total: modules.length,
    completed,
    progressPct: modules.length ? Math.round((completed / modules.length) * 100) : 0,
    current: items.filter((i) => i.unlocked && i.status !== 'COMPLETED')[0] || null,
    modules: items,
  };
}

// La validación de desbloqueo vive en el backend (no basta con ocultar en el frontend).
export async function getModule(req, month) {
  const userId = req.subjectId;
  const mod = await prisma.academyModule.findUnique({ where: { month } });
  if (!mod) throw notFound('Módulo no encontrado');
  const { activatedAt } = await context(userId);
  const unlocked = isModuleUnlocked(month, activatedAt);
  if (!unlocked && !req.asAdmin) throw forbidden('Este módulo aún no está disponible en tu suscripción');
  const progress = await prisma.moduleProgress.findUnique({ where: { userId_moduleId: { userId, moduleId: mod.id } } });
  return { ...describe(mod, activatedAt, progress), content: mod.content, exercise: progress?.exercise || null, toolData: progress?.toolData || null };
}

export async function assertUnlocked(req, month) {
  const { activatedAt } = await context(req.subjectId);
  if (!isModuleUnlocked(month, activatedAt) && !req.asAdmin) {
    throw forbidden('Esta herramienta se desbloquea con su módulo mensual');
  }
}

export async function saveProgress(req, month, data) {
  const mod = await prisma.academyModule.findUnique({ where: { month } });
  if (!mod) throw notFound('Módulo no encontrado');
  await assertUnlocked(req, month);
  const userId = req.subjectId;
  const where = { userId_moduleId: { userId, moduleId: mod.id } };
  const before = await prisma.moduleProgress.findUnique({ where });
  const completedAt = data.status === 'COMPLETED' ? before?.completedAt || new Date() : null;
  const row = await prisma.moduleProgress.upsert({
    where,
    create: { userId, moduleId: mod.id, ...data, completedAt },
    update: { ...data, completedAt },
  });
  return { before, row };
}

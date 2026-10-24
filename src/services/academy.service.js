import { prisma } from '../config/prisma.js';
import { ACTIVE_MODULES, BLOCK1_MODULES, BLOCK2_MODULES, canChooseRoute, canReadAcademy, isModuleOpen, moduleState } from '../domain/access.js';
import { evaluateMarketFilter, professionalOperation, riskExposure, simulateTrade, buildAllocation } from '../domain/learning.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import { accessFor } from './access.service.js';

const STATE_MESSAGES = {
  LOCKED_ACCESS: 'Necesitas el acceso completo o la herramienta de este módulo',
  LOCKED_ORDER: 'Completa el módulo anterior para continuar',
  LOCKED_FILTER: 'Aprueba el filtro previo de la Ruta de Mercados para habilitar este módulo',
  LOCKED_ROUTE: 'Selecciona la Ruta de Mercados para continuar con el Módulo 4',
};

export const SIMULATORS = {
  3: { kind: 'PORTFOLIO_SIMULATION', run: buildAllocation },
  4: { kind: 'RISK_EXPOSURE', run: riskExposure },
  5: { kind: 'TRADE', run: simulateTrade },
  6: { kind: 'PROFESSIONAL_OPERATION', run: professionalOperation },
};

export async function learningContext(req) {
  const userId = req.subjectId;
  const [access, modules, progress, learning, lastFilter] = await Promise.all([
    accessFor(req),
    prisma.academyModule.findMany({ orderBy: { month: 'asc' }, select: { id: true, month: true, block: true, title: true, summary: true } }),
    prisma.moduleProgress.findMany({ where: { userId }, include: { module: { select: { month: true } } } }),
    prisma.learningState.findUnique({ where: { userId } }),
    prisma.marketRouteAssessment.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ]);
  const completed = progress.filter((p) => p.status === 'COMPLETED').map((p) => p.module.month);
  const passedFilter = await prisma.marketRouteAssessment.count({ where: { userId, passed: true } });
  return {
    access,
    modules,
    progress,
    completed,
    route: learning?.route || null,
    routeChosenAt: learning?.routeChosenAt || null,
    filterPassed: passedFilter > 0,
    lastFilter,
  };
}

const stateOf = (ctx, n) => moduleState(n, { access: ctx.access, completed: ctx.completed, route: ctx.route, filterPassed: ctx.filterPassed });

export async function academyOverview(req) {
  const ctx = await learningContext(req);
  const byModule = new Map(ctx.progress.map((p) => [p.module.month, p]));
  const view = (m) => ({
    number: m.month,
    title: m.title,
    summary: m.summary,
    state: stateOf(ctx, m.month),
    status: byModule.get(m.month)?.status || 'NOT_STARTED',
    completedAt: byModule.get(m.month)?.completedAt || null,
  });
  const block1 = ctx.modules.filter((m) => BLOCK1_MODULES.includes(m.month)).map(view);
  const block2 = ctx.modules.filter((m) => BLOCK2_MODULES.includes(m.month)).map(view);
  const completedOf = (list) => list.filter((m) => m.state === 'COMPLETED').length;
  const completedBlock1 = completedOf(block1);
  return {
    access: ctx.access,
    academyEnabled: canReadAcademy(ctx.access),
    route: ctx.route,
    routeAvailable: canChooseRoute(ctx.access, ctx.completed),
    filter: { passed: ctx.filterPassed, last: ctx.lastFilter ? { passed: ctx.lastFilter.passed, totalScore: ctx.lastFilter.totalScore, createdAt: ctx.lastFilter.createdAt } : null },
    progressPct: Math.round((completedBlock1 / BLOCK1_MODULES.length) * 100),
    block2ProgressPct: Math.round((completedOf(block2) / BLOCK2_MODULES.length) * 100),
    next: [...block1, ...block2].find((m) => m.state === 'AVAILABLE') || null,
    block1,
    block2,
  };
}

async function openModule(req, number, ctx) {
  if (!ACTIVE_MODULES.includes(number)) throw notFound('Módulo no encontrado');
  const state = stateOf(ctx, number);
  if (!req.asAdmin && !isModuleOpen(state)) throw forbidden(STATE_MESSAGES[state]);
  return state;
}

export async function getModule(req, number) {
  const ctx = await learningContext(req);
  const state = await openModule(req, number, ctx);
  const mod = await prisma.academyModule.findUnique({
    where: { month: number },
    include: { media: { where: { active: true }, orderBy: { position: 'asc' } } },
  });
  const progress = ctx.progress.find((p) => p.module.month === number);
  const full = canReadAcademy(ctx.access);
  const content = mod.content || {};
  return {
    number,
    block: mod.block,
    title: mod.title,
    summary: mod.summary,
    state,
    mode: full ? 'ACADEMY' : 'TOOL_ONLY',
    status: progress?.status || 'NOT_STARTED',
    exercise: progress?.exercise || null,
    completedAt: progress?.completedAt || null,
    tool: content.tool,
    essentials: content.essentials || [],
    riskNotes: content.riskNotes || [],
    lesson: full ? content.lesson || [] : null,
    exerciseGuide: full ? content.exercise || null : null,
    media: full
      ? mod.media.map((m) => ({ id: m.id, fileType: m.fileType, provider: m.provider, name: m.name, mimeType: m.mimeType, url: m.provider === 'CLOUDINARY' ? m.url : null }))
      : [],
  };
}

export async function assertToolOpen(req, number) {
  const ctx = await learningContext(req);
  await openModule(req, number, ctx);
  return ctx;
}

const COMPLETION_RULES = {
  1: async (userId) => (await prisma.moduleSubmission.count({ where: { userId, moduleNumber: 1 } })) > 0 || 'Guarda tu diagnóstico financiero antes de completar el módulo',
  2: async (userId) => (await prisma.asset.count({ where: { userId, productType: { not: null }, source: null } })) > 0 || 'Registra al menos un producto en tu mapa',
  3: async () => true,
  4: async (userId) => (await prisma.educationalSimulation.count({ where: { userId, moduleNumber: 4 } })) > 0 || 'Guarda al menos una simulación del módulo',
  5: async (userId) => (await prisma.educationalSimulation.count({ where: { userId, moduleNumber: 5 } })) > 0 || 'Guarda al menos una simulación del módulo',
  6: async (userId) => (await prisma.educationalSimulation.count({ where: { userId, moduleNumber: 6 } })) > 0 || 'Guarda al menos una simulación del módulo',
  7: async (userId) => (await prisma.budget.count({ where: { userId } })) > 0 || 'Guarda tu presupuesto mensual antes de completar el módulo',
  8: async (userId) => (await prisma.emergencyFundPlan.count({ where: { userId } })) > 0 || 'Guarda tu meta de fondo de emergencia',
  9: async () => true,
  10: async (userId) => (await prisma.taxAnalysisItem.count({ where: { userId } })) > 0 || 'Registra al menos un negocio o inversión',
  11: async (userId) => (await prisma.inflationScenario.count({ where: { userId } })) > 0 || 'Guarda al menos un escenario de inflación',
  12: async (userId) => (await prisma.annualReview.count({ where: { userId } })) > 0 || 'Guarda tu revisión patrimonial anual',
};

export async function saveProgress(req, number, { status, exercise, snapshot }) {
  await assertToolOpen(req, number);
  const userId = req.subjectId;
  if (status === 'COMPLETED') {
    const check = await COMPLETION_RULES[number](userId);
    if (check !== true) throw badRequest(check);
  }
  const mod = await prisma.academyModule.findUnique({ where: { month: number } });
  const where = { userId_moduleId: { userId, moduleId: mod.id } };
  const before = await prisma.moduleProgress.findUnique({ where });
  const completedAt = status === 'COMPLETED' ? before?.completedAt || new Date() : before?.completedAt || null;
  const finalStatus = before?.status === 'COMPLETED' ? 'COMPLETED' : status;
  const data = { status: finalStatus, completedAt, ...(exercise !== undefined ? { exercise } : {}) };
  const row = await prisma.moduleProgress.upsert({ where, create: { userId, moduleId: mod.id, ...data }, update: data });
  if (snapshot) await prisma.moduleSubmission.create({ data: { userId, moduleNumber: number, data: { type: 'SNAPSHOT' }, result: snapshot } });
  return row;
}

export async function chooseRoute(req, route) {
  const ctx = await learningContext(req);
  if (!req.asAdmin && !canChooseRoute(ctx.access, ctx.completed)) throw forbidden('Completa el Módulo 3 para elegir tu ruta');
  const userId = req.subjectId;
  const row = await prisma.learningState.upsert({
    where: { userId },
    create: { userId, route, routeChosenAt: new Date() },
    update: { route, routeChosenAt: new Date() },
  });
  return row;
}

export async function submitMarketFilter(req, answers) {
  const ctx = await learningContext(req);
  if (!req.asAdmin && !ctx.access.hasAny) throw forbidden('Necesitas un acceso activo');
  const result = evaluateMarketFilter(answers);
  const row = await prisma.marketRouteAssessment.create({ data: { userId: req.subjectId, answers, ...result } });
  return { ...result, createdAt: row.createdAt };
}

export async function runSimulation(req, number, input, save) {
  await assertToolOpen(req, number);
  const simulator = SIMULATORS[number];
  const result = simulator.run(input);
  if (save) {
    await prisma.educationalSimulation.create({ data: { userId: req.subjectId, moduleNumber: number, kind: simulator.kind, input, result } });
  }
  return { input, result, saved: !!save };
}

export const listSimulations = (userId, number) =>
  prisma.educationalSimulation.findMany({ where: { userId, moduleNumber: number }, orderBy: { createdAt: 'desc' }, take: 20 });

import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { badRequest, forbidden } from '../utils/httpError.js';

const MODELS = [
  'annualReviewNote', 'annualReview', 'annualReport', 'goal', 'inflationScenario', 'taxAnalysisItem',
  'savingContribution', 'emergencyFundPlan', 'budget', 'educationalSimulation', 'marketRouteAssessment',
  'learningState', 'moduleSubmission', 'moduleProgress', 'monthlyClose', 'businessFlow', 'patrimonialMovement',
  'protectionRecord', 'income', 'expense', 'debt', 'asset', 'financialPeriod', 'financialProfile',
];

export async function resetProfile(user, { confirm }) {
  if (!env.allowProfileReset) throw forbidden('El reinicio de perfil no está disponible');
  if (user.role !== 'CLIENT') throw forbidden('Solo un cliente puede reiniciar su propio perfil');
  if (confirm !== 'REINICIAR') throw badRequest('Escribe REINICIAR para confirmar');
  await prisma.$transaction(async (tx) => {
    for (const model of MODELS) await tx[model].deleteMany({ where: { userId: user.id } });
  });
  return { ok: true };
}

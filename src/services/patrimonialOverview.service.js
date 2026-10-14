import { prisma } from '../config/prisma.js';
import { debtTotals, inflationTotals, taxConsolidated } from '../domain/patrimonial.js';
import { num } from '../utils/money.js';
import { getBudget } from './budget.service.js';
import { emergencyFor } from './emergency.service.js';
import { latestReview } from './annualReview.service.js';

const decimals = (row, fields) => ({ ...row, ...Object.fromEntries(fields.map((f) => [f, num(row[f])])) });

export async function patrimonialOverview(userId, period, summary) {
  const [budget, plan, taxRows, scenarioRows, review] = await Promise.all([
    period ? getBudget(userId, { year: period.year, month: period.month }) : null,
    prisma.emergencyFundPlan.findUnique({ where: { userId } }),
    prisma.taxAnalysisItem.findMany({ where: { userId } }),
    prisma.inflationScenario.findMany({ where: { userId } }),
    latestReview(userId),
  ]);
  const emergency = period && summary ? await emergencyFor(userId, period, summary, plan) : null;
  return {
    budget: budget?.saved ? { year: budget.year, month: budget.month, view: budget.view } : null,
    emergency: emergency && { saved: !!plan, essentialSource: emergency.essential.source, liquid: emergency.liquid, result: emergency.result },
    debts: summary ? debtTotals(summary.debts.items, summary.cashflow.income) : null,
    estimates: taxRows.length ? taxConsolidated(taxRows.map((t) => decimals(t, ['capital', 'grossProfit', 'commissions', 'otherCosts', 'taxRate']))) : null,
    simulations: { scenarios: inflationTotals(scenarioRows.map((s) => decimals(s, ['capital', 'inflationRate', 'nominalRate']))).count },
    annualReview: review,
  };
}

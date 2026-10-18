import { debtEstimate } from '../shared/patrimonial.js';
import { num, round2, sum } from '../utils/money.js';

const RECONCILE_TOLERANCE = 0.005;

export function roi(initial, final) {
  const i = num(initial);
  if (i === 0) return null;
  return round2(((num(final) - i) / i) * 100);
}

export function capitalResult(initial, final) {
  const i = round2(num(initial));
  const f = round2(num(final));
  return { initial: i, final: f, result: round2(f - i), roi: roi(i, f) };
}

const pct = (part, total) => (num(total) === 0 ? 0 : round2((num(part) / num(total)) * 100));

export function summarizePortfolio(positions = []) {
  const products = positions.map((p) => ({
    assetId: p.assetId,
    positionId: p.id,
    name: p.name,
    institution: p.institution ?? null,
    notes: p.notes ?? null,
    productType: p.productType ?? null,
    source: p.source ?? null,
    categoryCode: p.category.code,
    categoryName: p.category.name,
    ...capitalResult(p.initialCapital, p.finalCapital),
  }));

  const globalInitial = sum(products, (p) => p.initial);
  const globalFinal = sum(products, (p) => p.final);

  const byCode = new Map();
  for (const p of positions) {
    if (!byCode.has(p.category.code)) byCode.set(p.category.code, { ...p.category, items: [] });
  }
  for (const prod of products) byCode.get(prod.categoryCode).items.push(prod);

  const categories = [...byCode.values()]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => {
      const initial = sum(c.items, (p) => p.initial);
      const final = sum(c.items, (p) => p.final);
      return {
        code: c.code,
        name: c.name,
        count: c.items.length,
        ...capitalResult(initial, final),
        share: pct(final, globalFinal),
      };
    });

  return {
    products: products.map((p) => ({ ...p, share: pct(p.final, globalFinal) })),
    categories,
    global: capitalResult(globalInitial, globalFinal),
  };
}

export function summarizeMovements(movements = []) {
  const contributions = sum(movements.filter((m) => m.type === 'APORTACION'), (m) => m.amount);
  const withdrawals = sum(movements.filter((m) => m.type === 'DEDUCCION'), (m) => m.amount);
  return { contributions, withdrawals, net: round2(contributions - withdrawals) };
}

export function finalNetWorth({ opening, contributions, withdrawals, profitability }) {
  return round2(num(opening) + num(contributions) - num(withdrawals) + num(profitability));
}

export function reconcile(portfolioFinal, movementsFinal) {
  const difference = round2(num(portfolioFinal) - num(movementsFinal));
  return {
    portfolioFinal: round2(portfolioFinal),
    movementsFinal: round2(movementsFinal),
    difference,
    reconciled: Math.abs(difference) < RECONCILE_TOLERANCE,
  };
}

function groupTotals(items, key) {
  const total = sum(items, (i) => i.amount);
  const map = new Map();
  for (const it of items) map.set(it[key], round2((map.get(it[key]) || 0) + num(it.amount)));
  return [...map.entries()]
    .map(([k, amount]) => ({ key: k, amount, share: pct(amount, total) }))
    .sort((a, b) => b.amount - a.amount);
}

export function summarizeCashflow(incomes = [], expenses = []) {
  const income = sum(incomes, (i) => i.amount);
  const expense = sum(expenses, (e) => e.amount);
  const savings = round2(income - expense);
  return {
    income,
    expenses: expense,
    savings,
    savingsRate: income === 0 ? null : pct(savings, income),
    incomeByCategory: groupTotals(incomes, 'category'),
    expenseByCategory: groupTotals(expenses, 'category'),
  };
}

export const INSURANCE_TYPES = ['SEGURO_GASTOS_MEDICOS', 'SEGURO_VIDA', 'OTRO_SEGURO'];

export function summarizeProtection(records = []) {
  const liquid = records.filter((r) => !INSURANCE_TYPES.includes(r.type));
  const insurance = records.filter((r) => INSURANCE_TYPES.includes(r.type));
  return {
    total: sum(liquid, (r) => r.amount),
    coverage: sum(insurance, (r) => r.amount),
    insuranceTypes: [...new Set(insurance.map((r) => r.type))],
    byType: groupTotals(liquid, 'type'),
  };
}

export function summarizeBusiness(flows = []) {
  const items = flows.map((f) => ({
    id: f.id,
    assetId: f.assetId,
    name: f.name,
    revenue: round2(num(f.revenue)),
    costs: round2(num(f.costs)),
    net: round2(num(f.revenue) - num(f.costs)),
    notes: f.notes ?? null,
  }));
  return {
    items,
    revenue: sum(items, (i) => i.revenue),
    costs: sum(items, (i) => i.costs),
    net: sum(items, (i) => i.net),
  };
}

export function buildIndicators({ portfolio, cashflow, protection, debts, assets }) {
  const highRisk = portfolio.categories.find((c) => c.code === 'ALTO_RIESGO');
  const top = [...portfolio.categories].sort((a, b) => b.final - a.final)[0];
  return {
    monthsCovered: cashflow.expenses > 0 ? round2(protection.total / cashflow.expenses) : null,
    debtToAssets: assets > 0 ? pct(debts.totalBalance, assets) : null,
    debtPaymentToIncome: cashflow.income > 0 ? pct(debts.totalPayment, cashflow.income) : null,
    highRiskShare: highRisk ? highRisk.share : 0,
    topCategory: top ? { code: top.code, name: top.name, share: top.share } : null,
    categoriesUsed: portfolio.categories.length,
    hasMedicalInsurance: protection.insuranceTypes.includes('SEGURO_GASTOS_MEDICOS'),
    hasLifeInsurance: protection.insuranceTypes.includes('SEGURO_VIDA'),
  };
}

export function summarizeDebts(debts = []) {
  const items = debts.map((d) => {
    const estimate = debtEstimate({ balance: d.balance, annualRate: d.annualRate, payment: d.payment, fees: d.fees });
    return {
      id: d.id,
      balanceId: d.balanceId ?? null,
      name: d.name,
      lender: d.lender ?? null,
      type: d.type ?? 'OTRA',
      status: d.status,
      annualRate: estimate.annualRate,
      rateKnown: estimate.rateKnown,
      balance: round2(estimate.balance),
      payment: round2(estimate.payment),
      fees: round2(estimate.fees),
      monthlyInterest: estimate.monthlyInterest === null ? null : round2(estimate.monthlyInterest),
      monthlyCost: round2(estimate.monthlyCost),
      principalContribution: round2(estimate.principalContribution),
      paymentBelowCost: estimate.paymentBelowCost,
    };
  });
  return {
    items,
    totalBalance: sum(items, (d) => d.balance),
    totalPayment: sum(items, (d) => d.payment),
    totalFees: sum(items, (d) => d.fees),
    totalMonthlyInterest: sum(items, (d) => d.monthlyInterest),
    totalMonthlyCost: sum(items, (d) => d.monthlyCost),
    ratesIncomplete: items.some((d) => !d.rateKnown),
  };
}

export function buildPeriodSummary({ opening = 0, positions, movements, incomes, expenses, protection, debts, businessFlows = [] }) {
  const portfolio = summarizePortfolio(positions);
  const mov = summarizeMovements(movements);
  const profitability = portfolio.global.result;
  const movementsFinal = finalNetWorth({
    opening,
    contributions: mov.contributions,
    withdrawals: mov.withdrawals,
    profitability,
  });
  const reconciliation = reconcile(portfolio.global.final, movementsFinal);
  const cashflow = summarizeCashflow(incomes, expenses);
  const prot = summarizeProtection(protection);
  const debt = summarizeDebts(debts);

  const investments = portfolio.global.final;
  const assets = round2(investments + prot.total);
  const liabilities = debt.totalBalance;
  const indicators = buildIndicators({ portfolio, cashflow, protection: prot, debts: debt, assets });

  return {
    patrimony: {
      opening: round2(num(opening)),
      contributions: mov.contributions,
      withdrawals: mov.withdrawals,
      netMovement: mov.net,
      profitability,
      final: portfolio.global.final,
      variation: round2(portfolio.global.final - num(opening)),
    },
    reconciliation,
    portfolio,
    cashflow,
    protection: prot,
    debts: debt,
    business: summarizeBusiness(businessFlows),
    indicators,
    balanceSheet: {
      investments,
      liquidity: prot.total,
      assets,
      liabilities,
      netWorth: round2(assets - liabilities),
    },
  };
}

import { num, round2, sum } from '../utils/money.js';

const pctOf = (part, total) => (num(total) === 0 ? null : round2((num(part) / num(total)) * 100));

export const SAVING_LEVELS = [
  { min: 20, key: 'GOOD', label: 'Buena capacidad de ahorro' },
  { min: 10, key: 'MODERATE', label: 'Capacidad moderada' },
  { min: -Infinity, key: 'REVIEW', label: 'Revisar estructura de gastos' },
];

export function diagnose(input) {
  const income = num(input.income);
  const expenses = num(input.expenses);
  const debtPayment = num(input.debtPayment);
  const monthlyInvestment = num(input.monthlyInvestment);
  const cash = num(input.cash);
  const investments = num(input.investments);
  const otherAssets = num(input.otherAssets);
  const totalDebt = num(input.totalDebt);

  const savings = round2(income - expenses - debtPayment);
  const savingRate = pctOf(savings, income);
  const totalAssets = round2(cash + investments + otherAssets);
  const netWorth = round2(totalAssets - totalDebt);
  const liquidityMonths = expenses === 0 ? null : round2(cash / expenses);
  const savingLevel = savingRate === null ? null : SAVING_LEVELS.find((l) => savingRate >= l.min);

  return {
    savings,
    savingRate,
    savingLevel: savingLevel ? { key: savingLevel.key, label: savingLevel.label } : null,
    totalAssets,
    netWorth,
    liquidityMonths,
    investmentToNetWorth: netWorth > 0 ? pctOf(investments, netWorth) : null,
    debtToNetWorth: netWorth > 0 ? pctOf(totalDebt, netWorth) : null,
    freeCashFlow: round2(income - expenses - debtPayment - monthlyInvestment),
  };
}

export const PRODUCT_CATEGORY = {
  RENTA_FIJA: 'RENTA_FIJA',
  RENTA_VARIABLE: 'RENTA_VARIABLE',
  FONDOS: 'RENTA_VARIABLE',
  ACCIONES: 'RENTA_VARIABLE',
  BIENES_RAICES: 'BIENES_RAICES',
  NEGOCIO: 'NEGOCIOS',
  ACTIVO_DIGITAL: 'ACTIVOS_DIGITALES',
  ALTO_RIESGO: 'ALTO_RIESGO',
  LIQUIDEZ: 'LIQUIDEZ',
};

export const PLACEHOLDERS = {
  M1_CASH: { category: 'LIQUIDEZ', name: 'Efectivo y liquidez (diagnóstico)', field: 'declaredCash', covers: ['LIQUIDEZ'] },
  M1_INVESTMENTS: {
    category: 'PENDIENTE_DESGLOSE',
    name: 'Inversiones por desglosar (diagnóstico)',
    field: 'declaredInvestments',
    covers: ['RENTA_FIJA', 'RENTA_VARIABLE', 'FONDOS', 'ACCIONES', 'ACTIVO_DIGITAL', 'ALTO_RIESGO'],
  },
  M1_OTHER_ASSETS: { category: 'OTROS_ACTIVOS', name: 'Bienes y otros activos (diagnóstico)', field: 'declaredOtherAssets', covers: ['BIENES_RAICES', 'NEGOCIO'] },
};

export function placeholderAmounts(profile, products = []) {
  return Object.fromEntries(
    Object.entries(PLACEHOLDERS).map(([source, p]) => {
      const covered = sum(products.filter((x) => p.covers.includes(x.productType)), (x) => x.capital);
      return [source, round2(Math.max(0, num(profile?.[p.field]) - covered))];
    }),
  );
}

export const ALLOCATION_BUCKETS = [
  { key: 'RENTA_FIJA', label: 'Renta fija', categories: ['RENTA_FIJA'] },
  { key: 'RENTA_VARIABLE', label: 'Renta variable', categories: ['RENTA_VARIABLE'] },
  { key: 'BIENES_RAICES', label: 'Bienes raíces', categories: ['BIENES_RAICES'] },
  { key: 'NEGOCIOS', label: 'Negocios', categories: ['NEGOCIOS'] },
  { key: 'LIQUIDEZ', label: 'Liquidez', categories: ['LIQUIDEZ'] },
  { key: 'ALTO_RIESGO', label: 'Alto riesgo', categories: ['ACTIVOS_DIGITALES', 'ALTO_RIESGO'] },
];

const scale = (value, steps) => steps.find(([limit]) => value <= limit)?.[1] ?? 0;

export const READING_LEVELS = [
  { min: 80, key: 'EQUILIBRADA', label: 'Equilibrada' },
  { min: 60, key: 'MODERADA', label: 'Moderada' },
  { min: 40, key: 'CONCENTRADA', label: 'Concentrada' },
  { min: -Infinity, key: 'MUY_CONCENTRADA', label: 'Muy concentrada' },
];

const diversificationScore = (n) => (n >= 5 ? 100 : { 4: 80, 3: 60, 2: 30, 1: 0 }[n] ?? 0);
const categoryCountScore = (n) => ({ 6: 100, 5: 90, 4: 80, 3: 65, 2: 40, 1: 10 }[n] ?? 0);
const concentrationScore = (top) => scale(top, [[30, 100], [40, 90], [50, 75], [60, 55], [70, 30], [Infinity, 0]]);
const highRiskScore = (pct) => scale(pct, [[10, 100], [20, 85], [30, 65], [40, 40], [Infinity, 15]]);

function liquidityScore(pct) {
  if (pct < 5) return 60;
  if (pct < 10) return 80;
  if (pct <= 30) return 100;
  if (pct <= 40) return 80;
  return 60;
}

export function portfolioReading(shares) {
  const used = shares.filter((s) => s.amount > 0);
  if (!used.length) return null;
  const top = Math.max(...used.map((s) => s.share));
  const share = (key) => shares.find((s) => s.key === key)?.share ?? 0;
  const parts = {
    diversification: diversificationScore(used.length),
    concentration: concentrationScore(top),
    highRisk: highRiskScore(share('ALTO_RIESGO')),
    liquidity: liquidityScore(share('LIQUIDEZ')),
    categories: categoryCountScore(used.length),
  };
  const score = round2(
    parts.diversification * 0.3 + parts.concentration * 0.3 + parts.highRisk * 0.2 + parts.liquidity * 0.1 + parts.categories * 0.1,
  );
  const level = READING_LEVELS.find((l) => score >= l.min);
  return { score, key: level.key, label: level.label, parts, topShare: round2(top), categoriesUsed: used.length };
}

export function buildAllocation(amountsByBucket) {
  const total = round2(ALLOCATION_BUCKETS.reduce((acc, b) => acc + Math.max(0, num(amountsByBucket[b.key])), 0));
  const shares = ALLOCATION_BUCKETS.map((b) => {
    const amount = round2(Math.max(0, num(amountsByBucket[b.key])));
    return { key: b.key, label: b.label, amount, share: total === 0 ? 0 : round2((amount / total) * 100) };
  });
  return { total, shares, categoriesUsed: shares.filter((s) => s.amount > 0).length, reading: portfolioReading(shares) };
}

export function allocationFromPortfolio(products = []) {
  const amounts = {};
  let excluded = 0;
  for (const p of products) {
    const bucket = ALLOCATION_BUCKETS.find((b) => b.categories.includes(p.categoryCode));
    if (bucket) amounts[bucket.key] = num(amounts[bucket.key]) + num(p.final);
    else excluded += num(p.final);
  }
  return { ...buildAllocation(amounts), pendingBreakdown: round2(excluded) };
}

export const MARKET_FILTER = { tradingQuestions: ['q1', 'q2', 'q3'], exchangeQuestions: ['q4', 'q5', 'q6'] };

export function evaluateMarketFilter(answers) {
  const value = (k) => (Number(answers?.[k]) === 1 ? 1 : 0);
  const tradingScore = MARKET_FILTER.tradingQuestions.reduce((a, k) => a + value(k), 0);
  const exchangeScore = MARKET_FILTER.exchangeQuestions.reduce((a, k) => a + value(k), 0);
  const totalScore = tradingScore + exchangeScore;
  return { tradingScore, exchangeScore, totalScore, passed: tradingScore >= 2 && exchangeScore >= 2 && totalScore >= 5 };
}

export const LEVERAGE_OPTIONS = [1, 2, 5, 10, 25, 50, 100, 150];

export function riskExposure({ capital, leverage, movePct, favorable }) {
  const c = Math.max(0, num(capital));
  const lev = Math.max(1, num(leverage));
  const move = Math.abs(num(movePct));
  const exposure = round2(c * lev);
  const result = round2(exposure * (move / 100) * (favorable ? 1 : -1));
  return {
    capital: c,
    leverage: lev,
    exposure,
    movePct: favorable ? move : -move,
    result,
    resultOnMargin: c === 0 ? null : round2((result / c) * 100),
    comparison: [1, 10, 50].map((l) => {
      const exp = round2(c * l);
      return { leverage: l, exposure: exp, result: round2(exp * (move / 100) * (favorable ? 1 : -1)) };
    }),
  };
}

export function simulateTrade({ capital, direction, leverage, entryPrice, exitPrice, costPct }) {
  const c = Math.max(0, num(capital));
  const lev = Math.max(1, num(leverage));
  const entry = num(entryPrice);
  const exit = num(exitPrice);
  const exposure = round2(c * lev);
  const moveDecimal = entry === 0 ? 0 : direction === 'SHORT' ? (entry - exit) / entry : (exit - entry) / entry;
  const grossResult = round2(exposure * moveDecimal);
  const costs = round2(exposure * (Math.max(0, num(costPct)) / 100));
  const netResult = round2(grossResult - costs);
  return {
    capital: c,
    direction,
    leverage: lev,
    entryPrice: entry,
    exitPrice: exit,
    exposure,
    movePct: round2(moveDecimal * 100),
    grossResult,
    costs,
    netResult,
    resultOnMargin: c === 0 ? null : round2((netResult / c) * 100),
    favorable: moveDecimal >= 0,
  };
}

const AUTOMATION_POINTS = { MANUAL: 10, SEMI: 20, AUTO: 30 };
const MONITORING_POINTS = { BASIC: 10, CONTINUOUS: 20, ALERTS: 30 };

export const OPERATION_LEVELS = [
  { min: 85, key: 'ESTRUCTURADO', label: 'Estructurado' },
  { min: 65, key: 'MODERADO', label: 'Moderado' },
  { min: 45, key: 'BASICO', label: 'Básico' },
  { min: -Infinity, key: 'EXPOSICION_ELEVADA', label: 'Exposición elevada' },
];

export function professionalOperation({ capital, riskPct, positions, leverage, automation, monitoring }) {
  const c = Math.max(0, num(capital));
  const risk = Math.min(100, Math.max(0, num(riskPct)));
  const n = Math.max(1, Math.floor(num(positions)));
  const lev = Math.max(1, num(leverage));
  const riskMoneyPerTrade = round2((c * risk) / 100);
  const accumulatedRiskPct = round2(risk * n);
  const accumulatedRiskMoney = round2(riskMoneyPerTrade * n);
  const maxExposure = round2(c * lev);

  let score = 50 + (AUTOMATION_POINTS[automation] ?? 0) + (MONITORING_POINTS[monitoring] ?? 0);
  if (accumulatedRiskPct <= 5) score += 20;
  else if (accumulatedRiskPct <= 10) score += 10;
  else score -= 15;
  if (n > 10) score -= 10;
  const level = OPERATION_LEVELS.find((l) => score >= l.min);

  return {
    capital: c,
    riskPct: risk,
    positions: n,
    leverage: lev,
    automation,
    monitoring,
    riskMoneyPerTrade,
    accumulatedRiskPct,
    accumulatedRiskMoney,
    maxExposure,
    score,
    level: { key: level.key, label: level.label },
    comparison: [1, 5, 10].map((p) => ({ positions: p, accumulatedRiskPct: round2(risk * p), accumulatedRiskMoney: round2(riskMoneyPerTrade * p) })),
  };
}

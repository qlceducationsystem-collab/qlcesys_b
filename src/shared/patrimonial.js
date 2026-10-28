const toNumber = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const isBlank = (v) => v === null || v === undefined || v === '';
const total = (items, pick) => items.reduce((acc, it) => acc + toNumber(pick(it)), 0);

export const percentOf = (part, whole) => (toNumber(whole) === 0 ? null : (toNumber(part) / toNumber(whole)) * 100);

export const BUDGET_DEFAULTS = [
  ['VIVIENDA', 25],
  ['ALIMENTACION', 12],
  ['TRANSPORTE', 8],
  ['ENTRETENIMIENTO', 7],
  ['FLUJO_DISPONIBLE', 10],
  ['AHORRO', 20],
  ['INVERSION', 18],
];
export const TARGET_CATEGORIES = ['AHORRO', 'INVERSION'];
export const BUDGET_EXPENSE_CATEGORIES = ['VIVIENDA', 'ALIMENTACION', 'SERVICIOS', 'TRANSPORTE', 'SEGUROS', 'EDUCACION', 'ENTRETENIMIENTO', 'VIAJES', 'DEUDAS', 'OTROS'];
export const FREE_FLOW = 'FLUJO_DISPONIBLE';
export const BUDGET_CATEGORIES = [...BUDGET_EXPENSE_CATEGORIES, FREE_FLOW, ...TARGET_CATEGORIES];
export const BUDGET_OPTIONAL_CATEGORIES = BUDGET_CATEGORIES.filter((c) => c !== 'DEUDAS');
export const ESSENTIAL_CATEGORIES = ['VIVIENDA', 'ALIMENTACION', 'SERVICIOS', 'TRANSPORTE', 'SEGUROS', 'EDUCACION', 'DEUDAS'];
export const isEssentialCategory = (category) => ESSENTIAL_CATEGORIES.includes(category);
const PERCENT_TOLERANCE = 0.005;
export const CUSTOM_PREFIX = 'CUSTOM:';
export const CUSTOM_NAME_MAX = 40;
export const DIAGNOSIS_PENDING = 'DIAGNOSTICO_PENDIENTE';
export const DEBT_PLAN = 'DEUDAS_PLAN';
export const isCustomCategory = (category) => typeof category === 'string' && category.startsWith(CUSTOM_PREFIX);
export const customCategory = (name) => `${CUSTOM_PREFIX}${String(name).trim().replace(/\s+/g, ' ').slice(0, CUSTOM_NAME_MAX)}`;
export const customName = (category) => category.slice(CUSTOM_PREFIX.length);

export function budgetLine({ category, percent }, netIncome, actual) {
  const planned = (toNumber(netIncome) * toNumber(percent)) / 100;
  const real = toNumber(actual);
  const difference = planned - real;
  const kind = category === FREE_FLOW ? 'FREE' : TARGET_CATEGORIES.includes(category) ? 'TARGET' : 'EXPENSE';
  const status = kind === 'EXPENSE' ? (difference < 0 ? 'OVER' : 'WITHIN') : real >= planned ? 'MET' : 'PENDING';
  return { category, kind, percent: toNumber(percent), planned, actual: real, difference, status };
}

export function budgetView({ netIncome, lines = [], actuals = {} }) {
  const income = toNumber(netIncome);
  const pending = toNumber(actuals[DIAGNOSIS_PENDING]);
  const budgeted = new Set(lines.map((l) => l.category));
  const debtRecorded = toNumber(actuals.DEUDAS);
  const debtPayments = budgeted.has('DEUDAS') ? 0 : actuals[DEBT_PLAN] === undefined ? debtRecorded : toNumber(actuals[DEBT_PLAN]);
  const fixedActual = lines.filter((l) => l.category !== FREE_FLOW).reduce((acc, l) => acc + toNumber(actuals[l.category]), 0);
  const freeActual = income - fixedActual - debtPayments;
  const rows = lines.map((l) => budgetLine(l, income, l.category === FREE_FLOW ? freeActual : actuals[l.category]));
  const expenses = rows.filter((r) => r.kind === 'EXPENSE');
  const pick = (category) => rows.find((r) => r.category === category);
  const percentTotal = total(rows, (r) => r.percent);
  const percentGap = 100 - percentTotal;
  const expensesPlanned = total(expenses, (r) => r.planned);
  const expensesActual = total(expenses, (r) => r.actual);
  const totalActual = total(rows.filter((r) => r.kind !== 'FREE'), (r) => r.actual) + debtPayments;
  const unbudgeted = BUDGET_EXPENSE_CATEGORIES.filter((c) => c !== 'DEUDAS' && !budgeted.has(c) && toNumber(actuals[c]) > 0).map((c) => ({ category: c, actual: toNumber(actuals[c]) }));
  const unbudgetedExpenses = total(unbudgeted, (u) => u.actual);
  return {
    netIncome: income,
    rows,
    percentTotal,
    percentGap,
    complete: Math.abs(percentGap) < PERCENT_TOLERANCE,
    totalPlanned: total(rows, (r) => r.planned),
    expensesPlanned,
    expensesActual,
    expenseDifference: expensesPlanned - expensesActual,
    savingsPlanned: pick('AHORRO')?.planned ?? 0,
    savingsActual: pick('AHORRO')?.actual ?? 0,
    investmentPlanned: pick('INVERSION')?.planned ?? 0,
    investmentActual: pick('INVERSION')?.actual ?? 0,
    totalActual: totalActual + unbudgetedExpenses + pending,
    expensesActualTotal: expensesActual + unbudgetedExpenses + pending,
    estimatedBalance: income - totalActual - unbudgetedExpenses - pending,
    unbudgeted,
    unbudgetedExpenses,
    diagnosisPending: pending,
    debtPayments,
    debtRecorded,
    freeFlow: freeActual,
    tableBalance: income - totalActual,
  };
}

export const RESERVE_TARGETS = [1, 3, 6, 9, 12];

export function emergencyFund({ essentialExpenses, liquid, targetMonths, monthlyContribution }) {
  const essential = toNumber(essentialExpenses);
  const available = toNumber(liquid);
  const months = toNumber(targetMonths);
  const contribution = toNumber(monthlyContribution);
  const base = { essentialExpenses: essential, liquid: available, targetMonths: months, monthlyContribution: contribution };
  if (essential <= 0) return { ...base, valid: false, reason: 'ESSENTIAL_REQUIRED' };
  const target = essential * months;
  const gap = Math.max(0, target - available);
  const progress = target > 0 ? (available / target) * 100 : null;
  const monthsToGoal = gap === 0 ? 0 : contribution > 0 ? Math.ceil(Number((gap / contribution).toFixed(9))) : null;
  return {
    ...base,
    valid: true,
    monthsCovered: available / essential,
    target,
    gap,
    progress,
    progressVisual: progress === null ? 0 : Math.min(100, progress),
    monthsToGoal,
    status: gap === 0 ? 'REACHED' : contribution > 0 ? 'IN_PROGRESS' : 'NEEDS_CONTRIBUTION',
  };
}

export function debtEstimate({ balance, annualRate, payment, fees }) {
  const rateKnown = !isBlank(annualRate);
  const outstanding = toNumber(balance);
  const plannedPayment = toNumber(payment);
  const monthlyFees = toNumber(fees);
  const monthlyInterest = rateKnown ? (outstanding * toNumber(annualRate)) / 100 / 12 : null;
  const monthlyCost = (monthlyInterest ?? 0) + monthlyFees;
  const principalContribution = plannedPayment - monthlyCost;
  return {
    rateKnown,
    balance: outstanding,
    annualRate: rateKnown ? toNumber(annualRate) : null,
    payment: plannedPayment,
    fees: monthlyFees,
    monthlyInterest,
    monthlyCost,
    principalContribution,
    incomplete: !rateKnown,
    paymentBelowCost: principalContribution < 0,
  };
}

export function debtPayment({ balance, annualRate, fees, amount }) {
  const outstanding = toNumber(balance);
  const paid = toNumber(amount);
  const rateKnown = !isBlank(annualRate);
  const interest = rateKnown ? (outstanding * toNumber(annualRate)) / 100 / 12 : 0;
  const charges = toNumber(fees);
  const principal = Math.min(outstanding, Math.max(0, paid - interest - charges));
  return {
    amount: paid,
    rateKnown,
    interest,
    fees: charges,
    principal,
    previousBalance: outstanding,
    newBalance: Math.round((outstanding - principal) * 100) / 100,
  };
}

export function debtTotals(items = [], monthlyIncome = 0) {
  const estimates = items.map((d) => (d.monthlyCost === undefined ? debtEstimate(d) : d));
  const income = toNumber(monthlyIncome);
  const payments = total(estimates, (d) => d.payment);
  const interest = total(estimates, (d) => d.monthlyInterest);
  const fees = total(estimates, (d) => d.fees);
  return {
    count: estimates.length,
    balance: total(estimates, (d) => d.balance),
    payments,
    interest,
    fees,
    cost: interest + fees,
    principalContribution: payments - interest - fees,
    incomplete: estimates.some((d) => d.incomplete || d.rateKnown === false),
    income,
    paymentToIncome: income > 0 ? (payments / income) * 100 : null,
  };
}

export function taxItem({ capital, grossProfit, commissions, otherCosts, taxRate }) {
  const invested = toNumber(capital);
  const gross = toNumber(grossProfit);
  const costs = toNumber(commissions) + toNumber(otherCosts);
  const preTax = gross - costs;
  const taxBase = Math.max(0, preTax);
  const tax = (taxBase * toNumber(taxRate)) / 100;
  const net = gross - costs - tax;
  return {
    capital: invested,
    grossProfit: gross,
    costs,
    preTax,
    taxBase,
    tax,
    net,
    capitalPlusNet: invested + net,
    grossReturn: invested > 0 ? (gross / invested) * 100 : null,
    netReturn: invested > 0 ? (net / invested) * 100 : null,
  };
}

export function taxConsolidated(items = []) {
  const results = items.map((i) => ({ ...taxItem(i), period: i.period }));
  const capital = total(results, (r) => r.capital);
  const net = total(results, (r) => r.net);
  const periods = [...new Set(results.map((r) => r.period).filter(Boolean))];
  return {
    count: results.length,
    capital,
    grossProfit: total(results, (r) => r.grossProfit),
    costs: total(results, (r) => r.costs),
    tax: total(results, (r) => r.tax),
    net,
    netReturn: capital > 0 ? (net / capital) * 100 : null,
    periods,
    mixedPeriods: periods.length > 1,
  };
}

export const SCENARIO_LIMITS = { minRate: -99.99, maxRate: 1000, maxYears: 100 };

export function inflationScenario({ capital, years, inflationRate, nominalRate }) {
  const c = toNumber(capital);
  const y = toNumber(years);
  const i = toNumber(inflationRate) / 100;
  const r = toNumber(nominalRate) / 100;
  const inflationFactor = (1 + i) ** y;
  const nominalFuture = c * (1 + r) ** y;
  const realCapital = c / inflationFactor;
  return {
    capital: c,
    years: y,
    inflationFactor,
    nominalFuture,
    realFuture: nominalFuture / inflationFactor,
    futureCost: c * inflationFactor,
    realCapital,
    purchasingPowerLoss: c - realCapital,
    realRate: ((1 + r) / (1 + i) - 1) * 100,
  };
}

export function inflationTotals(items = []) {
  const results = items.map(inflationScenario);
  return {
    count: results.length,
    capital: total(results, (r) => r.capital),
    nominalFuture: total(results, (r) => r.nominalFuture),
    realFuture: total(results, (r) => r.realFuture),
  };
}

const monthIndex = ({ year, month }) => year * 12 + (month - 1);
const fromIndex = (idx) => ({ year: Math.floor(idx / 12), month: (idx % 12) + 1 });
const pad = (v) => String(v).padStart(2, '0');
const lastDay = ({ year, month }) => new Date(year, month, 0).getDate();

export const shiftMonth = (ym, delta) => fromIndex(monthIndex(ym) + delta);
export const sameMonth = (a, b) => a.year === b.year && a.month === b.month;
export const compareMonth = (a, b) => monthIndex(a) - monthIndex(b);

export function annualWindow(now = new Date()) {
  const endIdx = monthIndex({ year: now.getFullYear(), month: now.getMonth() + 1 }) - 1;
  const startIdx = endIdx - 11;
  const start = fromIndex(startIdx);
  const end = fromIndex(endIdx);
  return {
    start,
    end,
    startDate: `${start.year}-${pad(start.month)}-01`,
    endDate: `${end.year}-${pad(end.month)}-${pad(lastDay(end))}`,
    months: Array.from({ length: 12 }, (_, k) => fromIndex(startIdx + k)),
  };
}

export function netWorthChange({ initialAssets, finalAssets, initialDebts, finalDebts }) {
  const ia = toNumber(initialAssets);
  const fa = toNumber(finalAssets);
  const id = toNumber(initialDebts);
  const fd = toNumber(finalDebts);
  const initialNetWorth = ia - id;
  const finalNetWorth = fa - fd;
  const variation = finalNetWorth - initialNetWorth;
  return {
    initialAssets: ia,
    finalAssets: fa,
    initialDebts: id,
    finalDebts: fd,
    assetsChange: fa - ia,
    debtsChange: fd - id,
    initialNetWorth,
    finalNetWorth,
    variation,
    variationPercent: initialNetWorth === 0 ? null : (variation / Math.abs(initialNetWorth)) * 100,
  };
}

export function goalProgress(goalAmount, finalNetWorth) {
  if (isBlank(goalAmount)) return null;
  const goal = toNumber(goalAmount);
  const current = toNumber(finalNetWorth);
  return {
    goal,
    current,
    distance: goal - current,
    progress: goal > 0 ? (current / goal) * 100 : null,
    reached: goal > 0 && current >= goal,
  };
}

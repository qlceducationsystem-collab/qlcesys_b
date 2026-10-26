import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annualEvolution, annualWindow, budgetView, BUDGET_DEFAULTS, debtEstimate, debtTotals, emergencyFund,
  goalProgress, inflationScenario, netWorthChange, taxConsolidated, taxItem, whatChanged,
} from '../src/domain/patrimonial.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const defaults = BUDGET_DEFAULTS.map(([category, percent]) => ({ category, percent }));

describe('M7 · presupuesto', () => {
  test('distribución inicial suma 100% e importes planeados exactos', () => {
    const v = budgetView({ netIncome: 30000, lines: defaults });
    assert.equal(v.complete, true);
    assert.deepEqual(v.rows.map((r) => r.planned), [7500, 3600, 2400, 2100, 3000, 6000, 5400]);
    assert.equal(v.expensesPlanned, 18600);
    assert.equal(v.savingsPlanned, 6000);
    assert.equal(v.investmentPlanned, 5400);
  });

  test('96% y 105% no forman una distribución completa', () => {
    const short = budgetView({ netIncome: 30000, lines: defaults.map((l) => (l.category === 'VIVIENDA' ? { ...l, percent: 21 } : l)) });
    assert.equal(short.complete, false);
    close(short.percentGap, 4);
    const over = budgetView({ netIncome: 30000, lines: defaults.map((l) => (l.category === 'VIVIENDA' ? { ...l, percent: 30 } : l)) });
    assert.equal(over.complete, false);
    close(over.percentGap, -5);
  });

  test('desviación negativa, positiva y ahorro como objetivo (no gasto)', () => {
    const v = budgetView({ netIncome: 30000, lines: defaults, actuals: { VIVIENDA: 9000, ALIMENTACION: 3000, AHORRO: 2000 } });
    const housing = v.rows.find((r) => r.category === 'VIVIENDA');
    assert.equal(housing.difference, -1500);
    assert.equal(housing.status, 'OVER');
    assert.equal(v.rows.find((r) => r.category === 'ALIMENTACION').difference, 600);
    const savings = v.rows.find((r) => r.category === 'AHORRO');
    assert.equal(savings.kind, 'TARGET');
    assert.equal(savings.status, 'PENDING');
    assert.equal(v.expensesActual, 12000);
    assert.equal(v.savingsActual, 2000);
    assert.equal(v.estimatedBalance, 30000 - 14000);
  });

  test('gastos reales fuera del presupuesto también se descuentan del saldo estimado', () => {
    const v = budgetView({ netIncome: 100000, lines: defaults, actuals: { DEUDAS: 20000, OTROS: 60000 } });
    assert.deepEqual(v.unbudgeted, [{ category: 'OTROS', actual: 60000 }]);
    assert.equal(v.unbudgetedExpenses, 60000);
    assert.equal(v.expensesActualTotal, 80000);
    assert.equal(v.estimatedBalance, 20000);
  });
});

describe('M8 · fondo de emergencia', () => {
  test('ejemplo del documento', () => {
    const r = emergencyFund({ essentialExpenses: 18000, liquid: 36000, targetMonths: 3, monthlyContribution: 2000 });
    assert.equal(r.monthsCovered, 2);
    assert.equal(r.target, 54000);
    assert.equal(r.gap, 18000);
    assert.equal(r.progress.toFixed(2), '66.67');
    assert.equal(r.monthsToGoal, 9);
  });

  test('meta alcanzada, aportación cero y gastos esenciales cero', () => {
    const reached = emergencyFund({ essentialExpenses: 10000, liquid: 40000, targetMonths: 3, monthlyContribution: 0 });
    assert.equal(reached.gap, 0);
    assert.equal(reached.status, 'REACHED');
    assert.equal(reached.progressVisual, 100);
    assert.ok(reached.progress > 100);
    const noContribution = emergencyFund({ essentialExpenses: 18000, liquid: 36000, targetMonths: 3, monthlyContribution: 0 });
    assert.equal(noContribution.monthsToGoal, null);
    assert.equal(noContribution.status, 'NEEDS_CONTRIBUTION');
    const invalid = emergencyFund({ essentialExpenses: 0, liquid: 36000, targetMonths: 3, monthlyContribution: 2000 });
    assert.equal(invalid.valid, false);
    assert.equal(invalid.monthsCovered, undefined);
  });
});

describe('M9 · deudas', () => {
  test('ejemplo de tarjeta de crédito', () => {
    const d = debtEstimate({ balance: 28000, annualRate: 42, payment: 3500, fees: 150 });
    assert.equal(d.monthlyInterest, 980);
    assert.equal(d.monthlyCost, 1130);
    assert.equal(d.principalContribution, 2370);
    assert.equal(d.paymentBelowCost, false);
  });

  test('pago menor al costo es negativo; tasa desconocida no es 0%', () => {
    const low = debtEstimate({ balance: 28000, annualRate: 42, payment: 900, fees: 150 });
    assert.equal(low.principalContribution, -230);
    assert.equal(low.paymentBelowCost, true);
    const unknown = debtEstimate({ balance: 5000, annualRate: null, payment: 500, fees: 0 });
    assert.equal(unknown.rateKnown, false);
    assert.equal(unknown.monthlyInterest, null);
    assert.equal(unknown.annualRate, null);
    assert.equal(unknown.incomplete, true);
  });

  test('totales y proporción sobre ingreso (N/D con ingreso 0)', () => {
    const items = [{ balance: 28000, annualRate: 42, payment: 3500, fees: 150 }, { balance: 6500, annualRate: null, payment: 4000, fees: 0 }];
    const t = debtTotals(items, 30000);
    assert.equal(t.count, 2);
    assert.equal(t.balance, 34500);
    assert.equal(t.payments, 7500);
    assert.equal(t.paymentToIncome, 25);
    assert.equal(t.incomplete, true);
    assert.equal(debtTotals(items, 0).paymentToIncome, null);
  });
});

describe('M10 · impuestos y costo real', () => {
  test('ejemplo del documento', () => {
    const r = taxItem({ capital: 100000, grossProfit: 12000, commissions: 800, otherCosts: 200, taxRate: 25 });
    assert.equal(r.costs, 1000);
    assert.equal(r.preTax, 11000);
    assert.equal(r.tax, 2750);
    assert.equal(r.net, 8250);
    assert.equal(r.netReturn, 8.25);
    assert.equal(r.capitalPlusNet, 108250);
  });

  test('capital 0, ganancia negativa, tasas 0% y 100%', () => {
    assert.equal(taxItem({ capital: 0, grossProfit: 1000, commissions: 0, otherCosts: 0, taxRate: 10 }).netReturn, null);
    const loss = taxItem({ capital: 1000, grossProfit: -500, commissions: 100, otherCosts: 0, taxRate: 30 });
    assert.equal(loss.taxBase, 0);
    assert.equal(loss.tax, 0);
    assert.equal(loss.net, -600);
    assert.equal(taxItem({ capital: 1000, grossProfit: 100, commissions: 0, otherCosts: 0, taxRate: 0 }).net, 100);
    assert.equal(taxItem({ capital: 1000, grossProfit: 100, commissions: 0, otherCosts: 0, taxRate: 100 }).net, 0);
  });

  test('consolidado no promedia rendimientos y detecta periodos mezclados', () => {
    const c = taxConsolidated([
      { capital: 100000, grossProfit: 12000, commissions: 800, otherCosts: 200, taxRate: 25, period: 'MENSUAL' },
      { capital: 50000, grossProfit: 4500, commissions: 250, otherCosts: 100, taxRate: 20, period: 'TRIMESTRAL' },
    ]);
    close(c.net, 8250 + 3320);
    close(c.netReturn, ((8250 + 3320) / 150000) * 100);
    assert.equal(c.mixedPeriods, true);
  });
});

describe('M11 · inflación', () => {
  test('valores nominal, real, costo futuro y rendimiento real', () => {
    const r = inflationScenario({ capital: 100000, years: 10, inflationRate: 4, nominalRate: 6 });
    close(r.nominalFuture, 100000 * 1.06 ** 10);
    close(r.realFuture, (100000 * 1.06 ** 10) / 1.04 ** 10);
    close(r.futureCost, 100000 * 1.04 ** 10);
    close(r.realCapital, 100000 / 1.04 ** 10);
    close(r.realRate, (1.06 / 1.04 - 1) * 100);
  });

  test('años 0, capital 0 e inflación cercana a -100%', () => {
    const zeroYears = inflationScenario({ capital: 5000, years: 0, inflationRate: 4, nominalRate: 6 });
    assert.equal(zeroYears.nominalFuture, 5000);
    assert.equal(zeroYears.realFuture, 5000);
    assert.equal(inflationScenario({ capital: 0, years: 5, inflationRate: 4, nominalRate: 6 }).realFuture, 0);
    const deflation = inflationScenario({ capital: 1000, years: 2, inflationRate: -99.99, nominalRate: 0 });
    assert.ok(Number.isFinite(deflation.realFuture));
  });
});

describe('M12 · evolución patrimonial', () => {
  test('periodo automático: últimos 12 meses completos', () => {
    const w = annualWindow(new Date(2026, 9, 14));
    assert.equal(w.startDate, '2025-10-01');
    assert.equal(w.endDate, '2026-09-30');
    assert.equal(w.months.length, 12);
    assert.ok(!w.months.some((m) => m.year === 2026 && m.month === 10));
    const nov = annualWindow(new Date(2026, 10, 1));
    assert.equal(nov.startDate, '2025-11-01');
    assert.equal(nov.endDate, '2026-10-31');
  });

  test('fórmulas del ejemplo y patrimonio inicial 0', () => {
    const c = netWorthChange({ initialAssets: 1458000, finalAssets: 1533000, initialDebts: 250000, finalDebts: 205000 });
    assert.equal(c.initialNetWorth, 1208000);
    assert.equal(c.finalNetWorth, 1328000);
    assert.equal(c.variation, 120000);
    assert.equal(c.variationPercent.toFixed(2), '9.93');
    assert.equal(c.debtsChange, -45000);
    assert.equal(netWorthChange({ initialAssets: 0, finalAssets: 100, initialDebts: 0, finalDebts: 0 }).variationPercent, null);
  });

  test('meta: avance, distancia y meta superada', () => {
    assert.equal(goalProgress(1400000, 1328000).distance, 72000);
    assert.equal(goalProgress(1000000, 1328000).reached, true);
    assert.equal(goalProgress(null, 1328000), null);
    assert.equal(goalProgress(0, 10).progress, null);
  });

  const summary = (products, protection, debts) => ({
    portfolio: { products: products.map(([id, name, cat, initial, final]) => ({ assetId: id, name, categoryName: cat, initial, final })) },
    protection: { byType: protection.map(([key, amount]) => ({ key, amount })) },
    debts: { items: debts.map(([id, name, balance]) => ({ id, name, balance })) },
  });

  test('usa cortes históricos, detecta faltantes y no duplica la deuda', () => {
    const window = annualWindow(new Date(2026, 9, 14));
    const months = new Map([
      ['2025-9', { status: 'CLOSED', source: 'CLOSE', summary: summary([['a1', 'Inversiones', 'Renta variable', 300000, 300000]], [['FONDO_EMERGENCIA', 100000]], [['d1', 'Auto', 140000]]) }],
      ['2026-9', { status: 'OPEN', source: 'LIVE', summary: summary([['a1', 'Inversiones', 'Renta variable', 300000, 325000]], [['FONDO_EMERGENCIA', 120000]], [['d1', 'Auto', 105000]]) }],
    ]);
    const evo = annualEvolution(window, months);
    assert.equal(evo.hasData, true);
    assert.equal(evo.change.initialAssets, 400000);
    assert.equal(evo.change.finalAssets, 445000);
    assert.equal(evo.change.initialDebts, 140000);
    assert.equal(evo.change.finalDebts, 105000);
    assert.equal(evo.change.variation, 80000);
    assert.equal(evo.complete, false);
    assert.equal(evo.initialRef.mode, 'CLOSING');
    assert.ok(evo.warnings.some((w) => w.code === 'GAPS'));
    assert.ok(evo.warnings.some((w) => w.code === 'OPEN_MONTHS'));
    assert.equal(evo.distribution.reduce((a, d) => a + d.amount, 0), evo.change.finalAssets);
    const changes = whatChanged(evo, goalProgress(500000, evo.change.finalNetWorth));
    assert.ok(changes.find((c) => c.key === 'DEBTS').text.includes('disminuyeron'));
  });

  test('sin registros: información histórica incompleta, sin cifras inventadas', () => {
    const evo = annualEvolution(annualWindow(new Date(2026, 9, 14)), new Map());
    assert.equal(evo.hasData, false);
    assert.equal(evo.change, undefined);
    assert.equal(evo.warnings[0].code, 'NO_DATA');
  });
});

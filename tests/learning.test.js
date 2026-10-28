import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocationFromPortfolio, buildAllocation, diagnose, evaluateMarketFilter, placeholderAmounts,
  professionalOperation, riskExposure, simulateTrade,
} from '../src/domain/learning.js';

test('M1: diagnóstico con el ejemplo del documento', () => {
  const r = diagnose({
    income: 30000, expenses: 22000, debtPayment: 3000, monthlyInvestment: 3000,
    cash: 50000, investments: 100000, otherAssets: 250000, totalDebt: 80000, emergencyFund: 50000,
  });
  assert.equal(r.savings, 5000);
  assert.equal(r.savingRate, 16.67);
  assert.equal(r.savingLevel.key, 'MODERATE');
  assert.equal(r.netWorth, 320000);
  assert.equal(r.liquidityMonths, 2);
  assert.equal(r.investmentToNetWorth, 31.25);
  assert.equal(r.otherAssetsToNetWorth, 78.13);
  assert.equal(r.debtToNetWorth, 25);
  assert.equal(r.freeCashFlow, 2000);
});

test('M1: los meses de liquidez usan el efectivo y liquidez disponible, no el ingreso ni el fondo declarado', () => {
  const r = diagnose({ income: 100000, expenses: 60000, debtPayment: 20000, monthlyInvestment: 0, cash: 300000, investments: 0, otherAssets: 0, totalDebt: 0, emergencyFund: 100000 });
  assert.equal(r.liquidityMonths, 3.75);
  assert.equal(r.liquidityExpenses, 80000);
});

test('M1: casos límite sin ingresos, sin gastos y patrimonio negativo', () => {
  const r = diagnose({ income: 0, expenses: 0, debtPayment: 0, monthlyInvestment: 0, cash: 0, investments: 0, otherAssets: 0, totalDebt: 1000, emergencyFund: 0 });
  assert.equal(r.savingRate, null);
  assert.equal(r.savingLevel, null);
  assert.equal(r.liquidityMonths, null);
  assert.equal(r.netWorth, -1000);
  assert.equal(r.investmentToNetWorth, null);
  assert.equal(r.debtToNetWorth, null);
  assert.equal(diagnose({ income: 1000, expenses: 500, debtPayment: 0 }).savingLevel.key, 'GOOD');
  assert.equal(diagnose({ income: 1000, expenses: 950, debtPayment: 0 }).savingLevel.key, 'REVIEW');
});

test('M1→M2: las cifras globales se reducen conforme se desglosan productos', () => {
  const profile = { declaredCash: 50000, declaredInvestments: 100000, declaredOtherAssets: 250000 };
  const p = placeholderAmounts(profile, [
    { productType: 'RENTA_FIJA', capital: 40000 }, { productType: 'ACTIVO_DIGITAL', capital: 20000 },
    { productType: 'LIQUIDEZ', capital: 60000 }, { productType: 'BIENES_RAICES', capital: 250000 },
  ]);
  assert.equal(p.M1_INVESTMENTS, 40000);
  assert.equal(p.M1_CASH, 0);
  assert.equal(p.M1_OTHER_ASSETS, 0);
});

test('M3: lectura educativa del ejemplo del documento = Equilibrada (95)', () => {
  const a = buildAllocation({ RENTA_FIJA: 40000, RENTA_VARIABLE: 30000, BIENES_RAICES: 10000, NEGOCIOS: 5000, LIQUIDEZ: 5000, ALTO_RIESGO: 10000 });
  assert.equal(a.total, 100000);
  assert.equal(a.shares.find((s) => s.key === 'RENTA_FIJA').share, 40);
  assert.equal(a.reading.score, 95);
  assert.equal(a.reading.key, 'EQUILIBRADA');
});

test('M3: umbrales de concentración y clasificación', () => {
  assert.equal(buildAllocation({ ALTO_RIESGO: 100 }).reading.key, 'MUY_CONCENTRADA');
  const two = buildAllocation({ RENTA_FIJA: 60, RENTA_VARIABLE: 40 }).reading;
  assert.equal(two.parts.diversification, 30);
  assert.equal(two.parts.concentration, 55);
  assert.equal(two.parts.liquidity, 60);
  assert.equal(two.key, 'CONCENTRADA');
  assert.equal(buildAllocation({}).reading, null);
});

test('M3: allocation real desde Mi cartera agrupa activos digitales en alto riesgo y separa lo pendiente', () => {
  const a = allocationFromPortfolio([
    { categoryCode: 'RENTA_FIJA', final: 40000 }, { categoryCode: 'ACTIVOS_DIGITALES', final: 20000 },
    { categoryCode: 'ALTO_RIESGO', final: 5000 }, { categoryCode: 'PENDIENTE_DESGLOSE', final: 35000 },
  ]);
  assert.equal(a.total, 65000);
  assert.equal(a.shares.find((s) => s.key === 'ALTO_RIESGO').amount, 25000);
  assert.equal(a.pendingBreakdown, 35000);
});

test('Filtro de mercados: trading >= 2, exchange >= 2 y total >= 5', () => {
  assert.equal(evaluateMarketFilter({ q1: 1, q2: 1, q3: 1, q4: 1, q5: 1, q6: 0 }).passed, true);
  assert.equal(evaluateMarketFilter({ q1: 1, q2: 1, q3: 0, q4: 1, q5: 1, q6: 0 }).passed, false);
  assert.equal(evaluateMarketFilter({ q1: 1, q2: 1, q3: 1, q4: 1, q5: 0, q6: 0 }).passed, false);
  assert.deepEqual(evaluateMarketFilter({}), { tradingScore: 0, exchangeScore: 0, totalScore: 0, passed: false });
});

test('M4: exposición y resultado sobre margen', () => {
  const fav = riskExposure({ capital: 1000, leverage: 10, movePct: 2, favorable: true });
  assert.equal(fav.exposure, 10000);
  assert.equal(fav.result, 200);
  assert.equal(fav.resultOnMargin, 20);
  const adv = riskExposure({ capital: 1000, leverage: 50, movePct: 2, favorable: false });
  assert.equal(adv.result, -1000);
  assert.deepEqual(adv.comparison.map((c) => c.result), [-20, -200, -1000]);
});

test('M5: fórmulas exactas del documento (LONG favorable, SHORT y adverso)', () => {
  const t = simulateTrade({ capital: 1000, direction: 'LONG', leverage: 10, entryPrice: 100000, exitPrice: 102000, costPct: 0.1 });
  assert.deepEqual([t.exposure, t.movePct, t.grossResult, t.costs, t.netResult, t.resultOnMargin], [10000, 2, 200, 10, 190, 19]);
  const s = simulateTrade({ capital: 1000, direction: 'SHORT', leverage: 10, entryPrice: 100000, exitPrice: 98000, costPct: 0.1 });
  assert.equal(s.movePct, 2);
  assert.equal(s.netResult, 190);
  const l = simulateTrade({ capital: 1000, direction: 'LONG', leverage: 10, entryPrice: 100000, exitPrice: 98000, costPct: 0.1 });
  assert.deepEqual([l.grossResult, l.netResult, l.resultOnMargin, l.favorable], [-200, -210, -21, false]);
});

test('M6: riesgo por operación, acumulado y clasificación educativa', () => {
  const r = professionalOperation({ capital: 10000, riskPct: 1, positions: 5, leverage: 5, automation: 'SEMI', monitoring: 'CONTINUOUS' });
  assert.deepEqual([r.riskMoneyPerTrade, r.accumulatedRiskPct, r.accumulatedRiskMoney, r.maxExposure], [100, 5, 500, 50000]);
  assert.equal(r.score, 110);
  assert.equal(r.level.key, 'ESTRUCTURADO');
  const high = professionalOperation({ capital: 10000, riskPct: 2, positions: 12, leverage: 5, automation: 'MANUAL', monitoring: 'BASIC' });
  assert.equal(high.score, 45);
  assert.equal(high.level.key, 'BASICO');
});

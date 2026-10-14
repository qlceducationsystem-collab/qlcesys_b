import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPeriodSummary, capitalResult, finalNetWorth, reconcile, roi, summarizeCashflow,
  summarizeMovements, summarizePortfolio, summarizeProtection,
} from '../src/domain/finance.js';

const RF = { code: 'RENTA_FIJA', name: 'Renta fija', sortOrder: 1 };
const RV = { code: 'RENTA_VARIABLE', name: 'Renta variable', sortOrder: 2 };
const pos = (name, category, initialCapital, finalCapital) => ({ id: name, assetId: name, name, category, initialCapital, finalCapital });

test('ROI individual: (final - inicial) / inicial * 100', () => {
  assert.equal(roi(100000, 105000), 5);
  assert.deepEqual(capitalResult(100000, 105000), { initial: 100000, final: 105000, result: 5000, roi: 5 });
});

test('ROI con capital inicial 0 → null (N/D), sin dividir entre cero', () => {
  assert.equal(roi(0, 5000), null);
  assert.equal(capitalResult(0, 0).roi, null);
  assert.equal(capitalResult('0', '100').result, 100);
});

test('ROI negativo y valores con decimales', () => {
  assert.equal(roi(50000, 48900), -2.2);
  assert.equal(capitalResult('100.10', '100.30').result, 0.2);
});

test('ROI por categoría usa capitales agregados, NO promedio de ROI', () => {

  const p = summarizePortfolio([pos('A', RF, 100, 200), pos('B', RF, 900, 900)]);
  assert.equal(p.categories[0].roi, 10);
  assert.equal(p.categories[0].result, 100);
  assert.notEqual(p.categories[0].roi, 50);
});

test('ROI global sobre capital inicial global (datos del HTML de referencia)', () => {
  const p = summarizePortfolio([
    pos('CETES', RF, 100000, 100900), pos('Pagaré', RF, 60000, 60400), pos('Bonos', RF, 40000, 40500),
    pos('Acciones', RV, 180000, 182700), pos('Fondos', RV, 120000, 121500),
  ]);
  const [rf, rv] = p.categories;
  assert.deepEqual([rf.initial, rf.final, rf.result, rf.roi], [200000, 201800, 1800, 0.9]);
  assert.deepEqual([rv.initial, rv.final, rv.result, rv.roi], [300000, 304200, 4200, 1.4]);
  assert.deepEqual([p.global.initial, p.global.final, p.global.result, p.global.roi], [500000, 506000, 6000, 1.2]);
  assert.equal(rf.share + rv.share, 100);
});

test('Categoría con capital inicial 0 → ROI N/D', () => {
  const p = summarizePortfolio([pos('Nuevo', RF, 0, 1000)]);
  assert.equal(p.categories[0].roi, null);
  assert.equal(p.global.roi, null);
});

test('Sin activos: cartera vacía sin errores', () => {
  const p = summarizePortfolio([]);
  assert.deepEqual(p.global, { initial: 0, final: 0, result: 0, roi: null });
  assert.deepEqual(p.categories, []);
});

test('Muchos activos: sumas exactas sin error de punto flotante', () => {
  const many = Array.from({ length: 1000 }, (_, i) => pos(`P${i}`, i % 2 ? RF : RV, '0.10', '0.20'));
  const p = summarizePortfolio(many);
  assert.equal(p.global.initial, 100);
  assert.equal(p.global.final, 200);
  assert.equal(p.global.roi, 100);
});

test('Movimiento neto = aportaciones - deducciones', () => {
  const m = summarizeMovements([
    { type: 'APORTACION', amount: 100000 }, { type: 'DEDUCCION', amount: 50000 }, { type: 'APORTACION', amount: '0.5' },
  ]);
  assert.deepEqual(m, { contributions: 100000.5, withdrawals: 50000, net: 50000.5 });
  assert.deepEqual(summarizeMovements([]), { contributions: 0, withdrawals: 0, net: 0 });
});

test('Patrimonio final = inicial + aportaciones - deducciones + rentabilidad (ejemplo del documento)', () => {
  assert.equal(finalNetWorth({ opening: 1000000, contributions: 100000, withdrawals: 50000, profitability: 30000 }), 1080000);
});

test('Conciliación: diferencia 0 → conciliado; otra → no conciliado con diferencia', () => {
  assert.deepEqual(reconcile(1080000, 1080000), { portfolioFinal: 1080000, movementsFinal: 1080000, difference: 0, reconciled: true });
  const bad = reconcile(1085000, 1080000);
  assert.equal(bad.reconciled, false);
  assert.equal(bad.difference, 5000);
});

test('Resumen del periodo: ejemplo completo conciliado, sin duplicar aportaciones', () => {

  const s = buildPeriodSummary({
    opening: 1000000,
    positions: [pos('CETES', RF, 450000, 460000), pos('Acciones', RV, 600000, 620000)],
    movements: [{ type: 'APORTACION', amount: 100000 }, { type: 'DEDUCCION', amount: 50000 }],
    incomes: [], expenses: [], protection: [], debts: [],
  });
  assert.equal(s.patrimony.profitability, 30000);
  assert.equal(s.patrimony.netMovement, 50000);
  assert.equal(s.patrimony.final, 1080000);
  assert.equal(s.patrimony.variation, 80000);
  assert.equal(s.patrimony.variation, s.patrimony.netMovement + s.patrimony.profitability);
  assert.equal(s.reconciliation.reconciled, true);
});

test('Deducción no se convierte en pérdida de inversión', () => {
  const s = buildPeriodSummary({
    opening: 1000000,
    positions: [pos('CETES', RF, 950000, 950000)],
    movements: [{ type: 'DEDUCCION', amount: 50000 }],
    incomes: [], expenses: [], protection: [], debts: [],
  });
  assert.equal(s.patrimony.profitability, 0);
  assert.equal(s.portfolio.global.roi, 0);
  assert.equal(s.reconciliation.reconciled, true);
});

test('Aportación no registrada en movimientos → INFORMACIÓN NO CONCILIADA', () => {
  const s = buildPeriodSummary({
    opening: 1000000,
    positions: [pos('CETES', RF, 1100000, 1100000)],
    movements: [], incomes: [], expenses: [], protection: [], debts: [],
  });
  assert.equal(s.reconciliation.reconciled, false);
  assert.equal(s.reconciliation.difference, 100000);
});

test('Periodo sin información: todo en cero y conciliado', () => {
  const s = buildPeriodSummary({ opening: 0, positions: [], movements: [], incomes: [], expenses: [], protection: [], debts: [] });
  assert.equal(s.patrimony.final, 0);
  assert.equal(s.reconciliation.reconciled, true);
  assert.equal(s.cashflow.savingsRate, null);
  assert.equal(s.indicators.monthsCovered, null);
});

test('Capacidad de ahorro y porcentajes desde cantidades reales', () => {
  const c = summarizeCashflow(
    [{ category: 'SALARIO', amount: 35000 }, { category: 'NEGOCIO', amount: 15000 }],
    [{ category: 'VIVIENDA', amount: 12000 }, { category: 'ALIMENTACION', amount: 7000 }, { category: 'OTROS', amount: 13000 }],
  );
  assert.equal(c.income, 50000);
  assert.equal(c.expenses, 32000);
  assert.equal(c.savings, 18000);
  assert.equal(c.savingsRate, 36);
  assert.equal(c.expenseByCategory.find((e) => e.key === 'VIVIENDA').share, 37.5);
});

test('Gastos mayores que ingresos → ahorro negativo', () => {
  const c = summarizeCashflow([{ category: 'SALARIO', amount: 1000 }], [{ category: 'OTROS', amount: 1500 }]);
  assert.equal(c.savings, -500);
  assert.equal(c.savingsRate, -50);
});

test('Seguros no se suman como activo; liquidez sí', () => {
  const p = summarizeProtection([
    { type: 'FONDO_EMERGENCIA', amount: 60000 }, { type: 'LIQUIDEZ', amount: 40000 }, { type: 'SEGURO_GASTOS_MEDICOS', amount: 5000000 },
  ]);
  assert.equal(p.total, 100000);
  assert.equal(p.coverage, 5000000);
});

test('Balance: activos - pasivos = patrimonio neto; deuda es pasivo, no inversión', () => {
  const s = buildPeriodSummary({
    opening: 100000,
    positions: [pos('CETES', RF, 100000, 101000)],
    movements: [], incomes: [], expenses: [{ category: 'OTROS', amount: 10000 }],
    protection: [{ type: 'LIQUIDEZ', amount: 20000 }],
    debts: [{ id: 'd', name: 'Tarjeta', annualRate: 36, balance: 12000, payment: 1000 }],
  });
  assert.equal(s.balanceSheet.assets, 121000);
  assert.equal(s.balanceSheet.liabilities, 12000);
  assert.equal(s.balanceSheet.netWorth, 109000);
  assert.equal(s.debts.items[0].monthlyInterest, 360);
  assert.equal(s.indicators.monthsCovered, 2);
});

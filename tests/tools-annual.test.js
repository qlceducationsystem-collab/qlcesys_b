import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { netReturn, purchasingPower } from '../src/domain/tools.js';
import { buildAnnualReport } from '../src/domain/annual.js';
import { buildPeriodSummary } from '../src/domain/finance.js';
import { diffFields } from '../src/domain/audit.js';
import { verifyWebhookSignature } from '../src/services/mercadopago.client.js';

test('Rendimiento neto: impuesto sobre ganancia después de costos, no sobre capital', () => {
  const r = netReturn({ capital: 100000, returnRate: 10, commissions: 1000, otherCosts: 500, taxRate: 20 });
  assert.equal(r.gross, 10000);
  assert.equal(r.afterCosts, 8500);
  assert.equal(r.tax, 1700);
  assert.equal(r.net, 6800);
  assert.equal(r.netRate, 6.8);
});

test('Rendimiento neto sin costos ni impuesto; pérdida no genera impuesto; capital 0', () => {
  assert.equal(netReturn({ capital: 1000, returnRate: 5 }).net, 50);
  assert.equal(netReturn({ capital: 1000, returnRate: -5, taxRate: 30 }).tax, 0);
  assert.equal(netReturn({ capital: 0, returnRate: 5 }).netRate, null);
});

test('Poder adquisitivo: valor real = nominal / (1 + inflación)^años', () => {
  const r = purchasingPower({ amount: 100000, years: 2, inflationRate: 10, nominalRate: 0 });
  assert.equal(r.finalReal, 82644.63);
  assert.equal(r.lossOfPurchasingPower, 17355.37);
  assert.equal(r.beatsInflation, false);
  const g = purchasingPower({ amount: 100000, years: 1, inflationRate: 4, nominalRate: 8 });
  assert.equal(g.beatsInflation, true);
  assert.equal(g.realRate, 3.85);
});

const RF = { code: 'RENTA_FIJA', name: 'Renta fija', sortOrder: 1 };
const month = (m, opening, initial, final, extra = {}) => ({
  period: { month: m, label: `M${m}` },
  ...buildPeriodSummary({
    opening,
    positions: [{ id: 'a', assetId: 'a', name: 'CETES', category: RF, initialCapital: initial, finalCapital: final }],
    movements: extra.movements || [],
    incomes: [{ category: 'SALARIO', amount: 1000 }],
    expenses: [{ category: 'OTROS', amount: 600 }],
    protection: [], debts: [],
  }),
});

test('Informe anual consolida meses cerrados y separa movimientos de rentabilidad', () => {
  const months = [
    month(1, 1000, 1000, 1010),
    month(2, 1010, 1110, 1120, { movements: [{ type: 'APORTACION', amount: 100 }] }),
  ];
  const r = buildAnnualReport(2026, months);
  assert.equal(r.patrimony.opening, 1000);
  assert.equal(r.patrimony.final, 1120);
  assert.equal(r.patrimony.variation, 120);
  assert.equal(r.patrimony.contributions, 100);
  assert.equal(r.patrimony.profitability, 20);
  assert.equal(r.patrimony.variation, r.patrimony.netMovement + r.patrimony.profitability);
  assert.equal(r.cashflow.savings, 800);
  assert.equal(r.complete, false);
  assert.equal(r.products[0].result, 20);
  assert.ok(r.observations.some((o) => o.includes('Informe parcial')));
  assert.equal(buildAnnualReport(2026, []), null);
});

test('Bitácora: diff campo por campo con valor anterior y nuevo', () => {
  const changes = diffFields({ name: 'Casa A', finalCapital: '2000000.00', updatedAt: 1 }, { name: 'Casa A', finalCapital: 2150000, updatedAt: 2 });
  assert.deepEqual(changes, [{ field: 'finalCapital', oldValue: '2000000.00', newValue: '2150000' }]);
});

test('Firma de webhook de Mercado Pago (x-signature)', () => {
  const secret = 'test-secret';
  const ts = '1700000000';
  const manifest = `id:123456;request-id:req-1;ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  assert.equal(verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: '123456', secret }), true);
  assert.equal(verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId: 'req-2', dataId: '123456', secret }), false);
  assert.equal(verifyWebhookSignature({ signature: undefined, requestId: 'req-1', dataId: '1', secret }), false);
});

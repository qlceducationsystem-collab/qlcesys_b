import { createDoc, date, finish, kpis, money, pct, section, statusBanner, table } from './layout.js';

const CAT_COLS = [
  { label: 'Categoría', width: 0.28 },
  { label: 'Capital inicial', width: 0.18, align: 'right' },
  { label: 'Capital final', width: 0.18, align: 'right' },
  { label: 'Resultado', width: 0.16, align: 'right' },
  { label: 'ROI', width: 0.1, align: 'right' },
  { label: '% Cartera', width: 0.1, align: 'right' },
];

export function monthlyClosePdf(res, close) {
  const s = close.snapshot;
  const doc = createDoc(
    res,
    `QLC_Corte_${s.period.year}_${String(s.period.month).padStart(2, '0')}_r${close.revision}.pdf`,
    `Corte mensual — ${s.period.label}`,
    `${s.user?.name || ''} · ${s.user?.email || ''} · Cerrado el ${date(close.closedAt)} · Revisión ${close.revision}`,
  );

  section(doc, 'Resumen patrimonial');
  kpis(doc, [
    ['Patrimonio inicial', money(s.patrimony.opening)],
    ['Patrimonio final', money(s.patrimony.final)],
    ['Variación', money(s.patrimony.variation)],
    ['Aportaciones', money(s.patrimony.contributions)],
    ['Deducciones', money(s.patrimony.withdrawals)],
    ['Movimiento neto', money(s.patrimony.netMovement)],
    ['Rentabilidad', money(s.patrimony.profitability)],
    ['ROI global', pct(s.portfolio.global.roi)],
    ['Patrimonio neto (activos - pasivos)', money(s.balanceSheet.netWorth)],
  ]);

  section(doc, 'Conciliación');
  const rc = s.reconciliation;
  statusBanner(doc, rc.reconciled, 'PATRIMONIO CONCILIADO', 'INFORMACIÓN NO CONCILIADA', `Cartera ${money(rc.portfolioFinal)} · Movimientos ${money(rc.movementsFinal)} · Diferencia ${money(rc.difference)}`);

  section(doc, 'Resultados por categoría y distribución');
  table(doc, CAT_COLS, s.portfolio.categories.map((c) => [c.name, money(c.initial), money(c.final), money(c.result), pct(c.roi), pct(c.share)]));

  section(doc, 'Productos');
  table(
    doc,
    [
      { label: 'Producto', width: 0.26 },
      { label: 'Categoría', width: 0.18 },
      { label: 'Inicial', width: 0.15, align: 'right' },
      { label: 'Final', width: 0.15, align: 'right' },
      { label: 'Resultado', width: 0.14, align: 'right' },
      { label: 'ROI', width: 0.12, align: 'right' },
    ],
    s.portfolio.products.map((p) => [p.name, p.categoryName, money(p.initial), money(p.final), money(p.result), pct(p.roi)]),
  );

  section(doc, 'Movimientos patrimoniales');
  table(
    doc,
    [
      { label: 'Fecha', width: 0.18 },
      { label: 'Tipo', width: 0.18 },
      { label: 'Descripción', width: 0.44 },
      { label: 'Monto', width: 0.2, align: 'right' },
    ],
    (s.movements || []).map((m) => [new Date(m.date).toLocaleDateString('es-MX'), m.type === 'APORTACION' ? 'Aportación' : 'Deducción', m.description, money(m.amount)]),
  );

  section(doc, 'Flujo, liquidez y deuda del periodo');
  kpis(doc, [
    ['Ingresos', money(s.cashflow.income)],
    ['Gastos', money(s.cashflow.expenses)],
    ['Capacidad de ahorro', money(s.cashflow.savings)],
    ['Liquidez y protección', money(s.protection.total)],
    ['Deuda total', money(s.debts.totalBalance)],
    ['Pagos de deuda', money(s.debts.totalPayment)],
  ]);
  finish(doc);
}

export function annualReportPdf(res, report) {
  const s = report.snapshot;
  const doc = createDoc(
    res,
    `QLC_Informe_Anual_${s.year}.pdf`,
    `Informe patrimonial anual ${s.year}`,
    `${s.user?.name || ''} · ${s.user?.email || ''} · Generado el ${date(report.generatedAt)} · ${s.monthsClosed} de 12 periodos${s.complete ? '' : ' (parcial)'}`,
  );

  section(doc, 'Resumen del año');
  kpis(doc, [
    ['Patrimonio inicial anual', money(s.patrimony.opening)],
    ['Patrimonio final anual', money(s.patrimony.final)],
    ['Variación', money(s.patrimony.variation)],
    ['Crecimiento', pct(s.patrimony.growth)],
    ['Aportaciones', money(s.patrimony.contributions)],
    ['Deducciones', money(s.patrimony.withdrawals)],
    ['Rentabilidad acumulada', money(s.patrimony.profitability)],
    ['Ingresos acumulados', money(s.cashflow.income)],
    ['Gastos acumulados', money(s.cashflow.expenses)],
    ['Ahorro acumulado', money(s.cashflow.savings)],
    ['Deuda: inicio / fin', `${money(s.debt.start)} / ${money(s.debt.end)}`],
    ['Liquidez: inicio / fin', `${money(s.liquidity.start)} / ${money(s.liquidity.end)}`],
  ]);

  section(doc, '¿Qué cambió durante el año?');
  s.observations.forEach((o) => doc.text(`•  ${o}`, { paragraphGap: 4 }));

  section(doc, 'Evolución mensual');
  table(
    doc,
    [
      { label: 'Mes', width: 0.16 },
      { label: 'P. inicial', width: 0.14, align: 'right' },
      { label: 'Aport.', width: 0.12, align: 'right' },
      { label: 'Deduc.', width: 0.12, align: 'right' },
      { label: 'Rentab.', width: 0.12, align: 'right' },
      { label: 'P. final', width: 0.14, align: 'right' },
      { label: 'ROI', width: 0.08, align: 'right' },
      { label: 'Ahorro', width: 0.12, align: 'right' },
    ],
    s.monthly.map((m) => [m.label, money(m.opening), money(m.contributions), money(m.withdrawals), money(m.profitability), money(m.final), pct(m.roi), money(m.savings)]),
  );

  section(doc, 'Resultados por categoría');
  table(
    doc,
    [
      { label: 'Categoría', width: 0.4 },
      { label: 'Resultado acumulado', width: 0.22, align: 'right' },
      { label: 'Capital al cierre', width: 0.22, align: 'right' },
      { label: '% Cartera', width: 0.16, align: 'right' },
    ],
    s.categories.map((c) => [c.name, money(c.result), money(c.finalCapital), pct(c.share)]),
  );

  if (s.products?.length) {
    section(doc, 'Resultados por inversión');
    table(
      doc,
      [
        { label: 'Producto', width: 0.34 },
        { label: 'Categoría', width: 0.24 },
        { label: 'Resultado acumulado', width: 0.21, align: 'right' },
        { label: 'Capital al cierre', width: 0.21, align: 'right' },
      ],
      s.products.map((p) => [p.name, p.categoryName, money(p.result), money(p.finalCapital)]),
    );
  }
  finish(doc);
}

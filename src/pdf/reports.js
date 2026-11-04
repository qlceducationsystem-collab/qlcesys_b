import { customName, isCustomCategory } from '../domain/patrimonial.js';
import { createDoc, date, finish, kpis, money, pct, section, statusBanner, table } from './layout.js';

const CAT_COLS = [
  { label: 'Categoría', width: 0.28 },
  { label: 'Capital inicial', width: 0.18, align: 'right' },
  { label: 'Capital final', width: 0.18, align: 'right' },
  { label: 'Resultado', width: 0.16, align: 'right' },
  { label: 'ROI', width: 0.1, align: 'right' },
  { label: '% Portafolio', width: 0.1, align: 'right' },
];

const BUDGET_LABELS = {
  VIVIENDA: 'Renta de vivienda', ALIMENTACION: 'Alimentación', SERVICIOS: 'Servicios', TRANSPORTE: 'Transporte', SEGUROS: 'Seguros', EDUCACION: 'Educación',
  ENTRETENIMIENTO: 'Entretenimiento', VIAJES: 'Viajes', DEUDAS: 'Deudas', OTROS: 'Otros', FLUJO_DISPONIBLE: 'Flujo disponible', AHORRO: 'Ahorro', INVERSION: 'Inversión',
};

function budgetSection(doc, budget) {
  const v = budget.view;
  section(doc, 'Presupuesto del mes: planeado vs. real');
  table(
    doc,
    [
      { label: 'Categoría', width: 0.28 },
      { label: '% planeado', width: 0.14, align: 'right' },
      { label: 'Planeado', width: 0.2, align: 'right' },
      { label: 'Real', width: 0.19, align: 'right' },
      { label: 'Diferencia', width: 0.19, align: 'right' },
    ],
    v.rows.map((r) => [BUDGET_LABELS[r.category] || (isCustomCategory(r.category) ? customName(r.category) : r.category), pct(r.percent), money(r.planned), money(r.actual), money(r.difference)]),
  );
  kpis(doc, [
    ['Ingreso neto presupuestado', money(v.netIncome)],
    ['Gastos planeados / reales', `${money(v.expensesPlanned)} / ${money(v.expensesActual)}`],
    ['Saldo estimado', money(v.estimatedBalance)],
    ['Ahorro planeado / real', `${money(v.savingsPlanned)} / ${money(v.savingsActual)}`],
    ['Inversión planeada / real', `${money(v.investmentPlanned)} / ${money(v.investmentActual)}`],
  ]);
}

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const SCENARIO_TYPES = { AHORRO: 'Ahorro', INVERSION: 'Inversión', META: 'Meta financiera', EFECTIVO: 'Efectivo', OTRO: 'Otro' };

export function scenariosPdf(res, data, user) {
  const doc = createDoc(
    res,
    'QLC_Simulacion_Inflacion.pdf',
    'Simulador de poder adquisitivo — Mis escenarios',
    `${user?.name || ''} · ${user?.email || ''} · Generado el ${date(new Date())}`,
  );
  section(doc, 'Resumen');
  kpis(doc, [
    ['Escenarios', String(data.totals.count)],
    ['Capital total', money(data.totals.capital)],
    ['Valor nominal futuro', money(data.totals.nominalFuture)],
    ['Valor real futuro', money(data.totals.realFuture)],
  ]);
  section(doc, 'Escenarios guardados');
  table(
    doc,
    [
      { label: 'Escenario', width: 0.22 },
      { label: 'Capital', width: 0.14, align: 'right' },
      { label: 'Años', width: 0.07, align: 'right' },
      { label: 'Inflación', width: 0.1, align: 'right' },
      { label: 'Rendimiento', width: 0.11, align: 'right' },
      { label: 'Valor nominal', width: 0.13, align: 'right' },
      { label: 'Valor real', width: 0.13, align: 'right' },
      { label: 'Tasa real', width: 0.1, align: 'right' },
    ],
    data.items.map((s) => [`${s.name} (${SCENARIO_TYPES[s.type] || s.type})`, money(s.capital), String(s.years), pct(s.inflationRate), pct(s.nominalRate), money(s.result.nominalFuture), money(s.result.realFuture), pct(s.result.realRate)]),
  );
  section(doc, 'Pérdida de poder adquisitivo');
  table(
    doc,
    [
      { label: 'Escenario', width: 0.34 },
      { label: 'Costo futuro de lo mismo', width: 0.22, align: 'right' },
      { label: 'Capital en dinero de hoy', width: 0.22, align: 'right' },
      { label: 'Pérdida de poder adquisitivo', width: 0.22, align: 'right' },
    ],
    data.items.map((s) => [s.name, money(s.result.futureCost), money(s.result.realCapital), money(s.result.purchasingPowerLoss)]),
  );
  finish(doc);
}

export function budgetPdf(res, budget, user) {
  const label = `${MONTHS[budget.month - 1]} ${budget.year}`;
  const doc = createDoc(
    res,
    `QLC_Presupuesto_${budget.year}_${String(budget.month).padStart(2, '0')}.pdf`,
    `Presupuesto mensual — ${label}`,
    `${user?.name || ''} · ${user?.email || ''}${budget.updatedAt ? ` · Guardado el ${date(budget.updatedAt)}` : ''}`,
  );
  budgetSection(doc, budget);
  finish(doc);
}

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
  statusBanner(doc, rc.reconciled, 'PATRIMONIO CONCILIADO', 'INFORMACIÓN NO CONCILIADA', `Portafolio ${money(rc.portfolioFinal)} · Movimientos ${money(rc.movementsFinal)} · Diferencia ${money(rc.difference)}`);

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
  if (s.budget) budgetSection(doc, s.budget);
  if (s.emergency?.valid) {
    section(doc, 'Fondo de emergencia');
    kpis(doc, [
      ['Meses cubiertos', s.emergency.monthsCovered.toFixed(2)],
      ['Reserva objetivo', money(s.emergency.target)],
      ['Faltante', money(s.emergency.gap)],
    ]);
  }
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
      { label: '% Portafolio', width: 0.16, align: 'right' },
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

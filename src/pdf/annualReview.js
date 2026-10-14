import { createDoc, date, finish, kpis, money, paragraph, pct, section, statusBanner, table } from './layout.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const longDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
};

export const reviewFilename = (report) => `QLC_Evolucion_Patrimonial_${report.window.startDate}_${report.window.endDate}.pdf`;

export function annualReviewPdf(target, report) {
  const period = `${longDate(report.window.startDate)} – ${longDate(report.window.endDate)}`;
  const doc = createDoc(
    target,
    reviewFilename(report),
    'Mi evolución patrimonial',
    `${report.user?.name || ''} · Periodo: ${period} · Generado el ${date(report.generatedAt)} · Moneda: ${report.currency}`,
  );

  section(doc, 'Periodo analizado');
  paragraph(doc, `Últimos 12 meses calendario completos: del ${longDate(report.window.startDate)} al ${longDate(report.window.endDate)}. El mes en curso no se incluye.`);
  if (report.hasData) paragraph(doc, `Valores iniciales: ${report.initialRef.label}. Valores finales: ${report.finalRef.label}.`);
  statusBanner(doc, report.complete, 'INFORMACIÓN HISTÓRICA COMPLETA', 'INFORMACIÓN HISTÓRICA INCOMPLETA');
  report.warnings.forEach((w) => paragraph(doc, `•  ${w.message}`));

  if (report.hasData) {
    const c = report.change;
    section(doc, 'Indicadores principales');
    kpis(doc, [
      ['Patrimonio inicial', money(c.initialNetWorth)],
      ['Patrimonio final', money(c.finalNetWorth)],
      ['Variación patrimonial', money(c.variation)],
      ['Variación porcentual', pct(c.variationPercent)],
      ['Activos iniciales', money(c.initialAssets)],
      ['Activos finales', money(c.finalAssets)],
      ['Deudas iniciales', money(c.initialDebts)],
      ['Deudas finales', money(c.finalDebts)],
      ['Variación de activos', money(c.assetsChange)],
      ['Variación de deudas', money(c.debtsChange)],
    ], 2);

    section(doc, 'Activos');
    table(
      doc,
      [
        { label: 'Activo', width: 0.26 },
        { label: 'Categoría', width: 0.18 },
        { label: 'Inicial', width: 0.15, align: 'right' },
        { label: 'Final', width: 0.15, align: 'right' },
        { label: 'Variación', width: 0.15, align: 'right' },
        { label: 'Var. %', width: 0.11, align: 'right' },
      ],
      report.assets.map((a) => [a.name, a.category, money(a.initial), money(a.final), money(a.change), pct(a.changePercent)]),
    );

    section(doc, 'Deudas y obligaciones');
    table(
      doc,
      [
        { label: 'Obligación', width: 0.4 },
        { label: 'Saldo inicial', width: 0.2, align: 'right' },
        { label: 'Saldo final', width: 0.2, align: 'right' },
        { label: 'Variación', width: 0.2, align: 'right' },
      ],
      report.debts.map((d) => [d.name, money(d.initial), money(d.final), money(d.change)]),
    );

    section(doc, 'Distribución final por categoría');
    table(
      doc,
      [
        { label: 'Categoría', width: 0.5 },
        { label: 'Importe', width: 0.3, align: 'right' },
        { label: '% de activos', width: 0.2, align: 'right' },
      ],
      [...report.distribution.map((d) => [d.category, money(d.amount), pct(d.share)]), ['Total de activos', money(c.finalAssets), report.distribution.length ? '100.00%' : 'N/D']],
    );
  }

  section(doc, 'Meta patrimonial');
  if (report.goalProgress) {
    kpis(doc, [
      ['Meta patrimonial', money(report.goalProgress.goal)],
      ['Patrimonio final', money(report.goalProgress.current)],
      [report.goalProgress.reached ? 'Meta superada por' : 'Distancia a la meta', money(Math.abs(report.goalProgress.distance))],
      ['Avance', pct(report.goalProgress.progress)],
    ], 2);
  } else {
    paragraph(doc, report.goal ? 'No hay patrimonio final disponible para calcular el avance.' : 'No hay una meta patrimonial registrada en Metas financieras.');
  }

  section(doc, '¿Qué cambió durante el año?');
  if (report.changes.length) report.changes.forEach((ch) => paragraph(doc, `•  ${ch.text}`));
  else paragraph(doc, 'No hay información suficiente para describir cambios en este periodo.');

  section(doc, 'Notas de revisión anual');
  paragraph(doc, report.note?.note || 'Sin notas registradas.');

  section(doc, 'Avisos');
  paragraph(doc, 'Lectura educativa generada con los datos registrados en QLC. Un aumento de activos puede deberse a aportaciones, compras, revalorizaciones o rendimientos: no todo aumento es rentabilidad. No constituye asesoría financiera, fiscal ni recomendación de inversión.');
  finish(doc);
}

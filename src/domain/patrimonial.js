import { compareMonth, netWorthChange, percentOf, sameMonth, shiftMonth } from '../../../shared/patrimonial.js';
import { num } from '../utils/money.js';

export * from '../../../shared/patrimonial.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const monthLabel = ({ year, month }) => `${MONTHS[month - 1]} ${year}`;
export const monthKey = ({ year, month }) => `${year}-${month}`;
const fmt = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
const fixed = (n) => Number(n).toFixed(2);

const PROTECTION_NAMES = { LIQUIDEZ: 'Liquidez registrada', FONDO_EMERGENCIA: 'Fondo de emergencia', RESERVA: 'Reservas' };
export const LIQUIDITY_CATEGORY = 'Liquidez';

export function balancePoint(summary, { opening = false } = {}) {
  const assets = [
    ...summary.portfolio.products.map((p) => ({
      key: `A:${p.assetId}`,
      name: p.name,
      category: p.categoryName,
      value: num(opening ? p.initial : p.final),
    })),
    ...summary.protection.byType.map((t) => ({
      key: `P:${t.key}`,
      name: PROTECTION_NAMES[t.key] || t.key,
      category: LIQUIDITY_CATEGORY,
      value: num(t.amount),
    })),
  ];
  const debts = summary.debts.items.map((d) => ({ key: `D:${d.id}`, name: d.name, value: num(d.balance) }));
  return {
    assets,
    debts,
    totalAssets: assets.reduce((a, x) => a + x.value, 0),
    totalDebts: debts.reduce((a, x) => a + x.value, 0),
  };
}

function compareRows(initialRows, finalRows, withCategory) {
  const map = new Map();
  for (const r of initialRows) map.set(r.key, { key: r.key, name: r.name, category: r.category, initial: r.value, final: 0 });
  for (const r of finalRows) {
    const row = map.get(r.key) || { key: r.key, name: r.name, category: r.category, initial: 0, final: 0 };
    map.set(r.key, { ...row, name: r.name, category: r.category, final: r.value });
  }
  return [...map.values()].map((r) => ({
    key: r.key,
    name: r.name,
    ...(withCategory ? { category: r.category } : {}),
    initial: r.initial,
    final: r.final,
    change: r.final - r.initial,
    changePercent: r.initial > 0 ? ((r.final - r.initial) / r.initial) * 100 : null,
  }));
}

function distribution(assets) {
  const totalValue = assets.reduce((a, x) => a + x.value, 0);
  const byCategory = new Map();
  for (const a of assets) byCategory.set(a.category, (byCategory.get(a.category) || 0) + a.value);
  return [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount, share: percentOf(amount, totalValue) }))
    .sort((a, b) => b.amount - a.amount);
}

const liquidityOf = (assets) => assets.filter((a) => a.category === LIQUIDITY_CATEGORY).reduce((acc, a) => acc + a.value, 0);

export function annualEvolution(window, months) {
  const before = shiftMonth(window.start, -1);
  const available = window.months.filter((m) => months.has(monthKey(m)));
  const missing = window.months.filter((m) => !months.has(monthKey(m)));
  const warnings = [];
  const base = { window, months: window.months.map((m) => ({ ...m, label: monthLabel(m), status: months.get(monthKey(m))?.status || 'MISSING', source: months.get(monthKey(m))?.source || null })) };

  if (!available.length) {
    warnings.push({ code: 'NO_DATA', message: `Información histórica incompleta: no hay registros entre ${monthLabel(window.start)} y ${monthLabel(window.end)}.` });
    return { ...base, hasData: false, complete: false, warnings };
  }

  let initialPoint;
  let initialRef;
  if (months.has(monthKey(before))) {
    initialPoint = balancePoint(months.get(monthKey(before)).summary);
    initialRef = { ...before, mode: 'CLOSING', label: `cierre de ${monthLabel(before)}` };
  } else {
    const first = available[0];
    initialPoint = balancePoint(months.get(monthKey(first)).summary, { opening: true });
    initialRef = { ...first, mode: 'OPENING', label: `apertura de ${monthLabel(first)}` };
    if (!sameMonth(first, window.start)) {
      warnings.push({ code: 'LATE_START', message: `Información histórica incompleta: el primer registro disponible es ${monthLabel(first)}; faltan los datos de ${monthLabel(window.start)}. Los valores iniciales corresponden a la apertura de ${monthLabel(first)}.` });
    }
  }

  const last = available[available.length - 1];
  const finalPoint = balancePoint(months.get(monthKey(last)).summary);
  const finalRef = { ...last, mode: 'CLOSING', label: `cierre de ${monthLabel(last)}` };
  if (!sameMonth(last, window.end)) {
    warnings.push({ code: 'EARLY_END', message: `Información histórica incompleta: no hay registro de ${monthLabel(window.end)}. Los valores finales corresponden al cierre de ${monthLabel(last)}.` });
  }
  const gaps = missing.filter((m) => compareMonth(m, last) < 0 && (initialRef.mode === 'CLOSING' || compareMonth(m, available[0]) > 0));
  if (gaps.length) warnings.push({ code: 'GAPS', message: `Meses sin registro dentro del periodo: ${gaps.map(monthLabel).join(', ')}.` });
  const open = available.filter((m) => months.get(monthKey(m)).status === 'OPEN');
  if (open.length) warnings.push({ code: 'OPEN_MONTHS', message: `Meses sin corte cerrado (se usan los datos vigentes): ${open.map(monthLabel).join(', ')}.` });

  const change = netWorthChange({
    initialAssets: initialPoint.totalAssets,
    finalAssets: finalPoint.totalAssets,
    initialDebts: initialPoint.totalDebts,
    finalDebts: finalPoint.totalDebts,
  });

  return {
    ...base,
    hasData: true,
    complete: !warnings.some((w) => ['LATE_START', 'EARLY_END', 'GAPS'].includes(w.code)),
    warnings,
    initialRef,
    finalRef,
    change,
    assets: compareRows(initialPoint.assets, finalPoint.assets, true),
    debts: compareRows(initialPoint.debts, finalPoint.debts, false),
    distribution: distribution(finalPoint.assets),
    initialDistribution: distribution(initialPoint.assets),
    liquidity: { initial: liquidityOf(initialPoint.assets), final: liquidityOf(finalPoint.assets) },
  };
}

const direction = (value, up, down, same) => (value > 0 ? up : value < 0 ? down : same);

export function whatChanged(evolution, goal) {
  if (!evolution.hasData) return [];
  const c = evolution.change;
  const items = [];
  items.push({
    key: 'NET_WORTH',
    tone: direction(c.variation, 'good', 'bad', 'neutral'),
    text: direction(
      c.variation,
      `Tu patrimonio neto aumentó ${fmt(c.variation)}${c.variationPercent === null ? '' : ` (${fixed(c.variationPercent)}%)`}: pasó de ${fmt(c.initialNetWorth)} a ${fmt(c.finalNetWorth)}.`,
      `Tu patrimonio neto disminuyó ${fmt(Math.abs(c.variation))}${c.variationPercent === null ? '' : ` (${fixed(c.variationPercent)}%)`}: pasó de ${fmt(c.initialNetWorth)} a ${fmt(c.finalNetWorth)}.`,
      `Tu patrimonio neto se mantuvo en ${fmt(c.finalNetWorth)}.`,
    ),
  });
  items.push({
    key: 'ASSETS',
    tone: direction(c.assetsChange, 'good', 'bad', 'neutral'),
    text: direction(
      c.assetsChange,
      `Tus activos aumentaron ${fmt(c.assetsChange)}. El aumento puede deberse a aportaciones, compras, revalorizaciones o rendimientos; no todo es rentabilidad.`,
      `Tus activos disminuyeron ${fmt(Math.abs(c.assetsChange))}. Puede deberse a retiros, ventas, gastos o pérdidas de valor.`,
      'El valor total de tus activos no cambió.',
    ),
  });
  items.push({
    key: 'DEBTS',
    tone: direction(c.debtsChange, 'bad', 'good', 'neutral'),
    text: direction(
      c.debtsChange,
      `Tus deudas aumentaron ${fmt(c.debtsChange)}, lo que reduce tu patrimonio neto.`,
      `Tus deudas disminuyeron ${fmt(Math.abs(c.debtsChange))}. Reducir deudas mejora el patrimonio aunque los activos no aumenten.`,
      'El saldo total de tus deudas no cambió.',
    ),
  });
  const liq = evolution.liquidity.final - evolution.liquidity.initial;
  items.push({
    key: 'LIQUIDITY',
    tone: direction(liq, 'good', 'warn', 'neutral'),
    text: direction(
      liq,
      `Tu liquidez aumentó ${fmt(liq)} (de ${fmt(evolution.liquidity.initial)} a ${fmt(evolution.liquidity.final)}).`,
      `Tu liquidez disminuyó ${fmt(Math.abs(liq))} (de ${fmt(evolution.liquidity.initial)} a ${fmt(evolution.liquidity.final)}).`,
      `Tu liquidez se mantuvo en ${fmt(evolution.liquidity.final)}.`,
    ),
  });
  const topFinal = evolution.distribution[0];
  const topInitial = evolution.initialDistribution[0];
  if (topFinal) {
    const before = evolution.initialDistribution.find((d) => d.category === topFinal.category);
    const shifted = topInitial && topInitial.category !== topFinal.category;
    items.push({
      key: 'DISTRIBUTION',
      tone: 'neutral',
      text: shifted
        ? `La categoría con mayor peso cambió de ${topInitial.category} a ${topFinal.category} (${fixed(topFinal.share)}% de tus activos).`
        : `${topFinal.category} sigue siendo la categoría con mayor peso: ${before?.share == null ? '—' : `${fixed(before.share)}%`} al inicio y ${fixed(topFinal.share)}% al cierre.`,
    });
  }
  if (goal) {
    items.push({
      key: 'GOAL',
      tone: goal.reached ? 'good' : 'neutral',
      text: goal.reached
        ? `Alcanzaste tu meta patrimonial de ${fmt(goal.goal)}; la superas por ${fmt(Math.abs(goal.distance))}.`
        : `Llevas ${goal.progress === null ? '—' : `${fixed(goal.progress)}%`} de tu meta patrimonial de ${fmt(goal.goal)}; faltan ${fmt(goal.distance)}.`,
    });
  }
  return items;
}

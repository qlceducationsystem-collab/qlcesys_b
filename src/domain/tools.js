// Herramientas educativas de la Academia (Mes 10 y Mes 11). Funciones puras.
import { num, round2 } from '../utils/money.js';

/**
 * Calculadora de rendimiento neto (Mes 10).
 * Ganancia bruta = capital × rendimiento
 * Ganancia después de costos = bruta − comisiones − otros costos
 * Impuesto = ganancia después de costos × % impuesto (nunca sobre el capital; 0 si no hay ganancia)
 * Resultado después de impuestos = ganancia después de costos − impuesto
 */
export function netReturn({ capital, returnRate, commissions = 0, otherCosts = 0, taxRate = 0 }) {
  const c = num(capital);
  const gross = round2((c * num(returnRate)) / 100);
  const afterCosts = round2(gross - num(commissions) - num(otherCosts));
  const tax = afterCosts > 0 ? round2((afterCosts * num(taxRate)) / 100) : 0;
  const net = round2(afterCosts - tax);
  return {
    capital: round2(c),
    gross,
    commissions: round2(num(commissions)),
    otherCosts: round2(num(otherCosts)),
    afterCosts,
    tax,
    net,
    netRate: c === 0 ? null : round2((net / c) * 100),
    finalCapital: round2(c + net),
  };
}

/**
 * Simulador de poder adquisitivo (Mes 11).
 * Valor real ≈ valor nominal / (1 + inflación)^años
 * Si se indica un rendimiento nominal, compara crecimiento nominal vs. real.
 */
export function purchasingPower({ amount, years, inflationRate, nominalRate = 0 }) {
  const a = num(amount);
  const inf = num(inflationRate) / 100;
  const nom = num(nominalRate) / 100;
  const n = Math.max(0, Math.floor(num(years)));
  const rows = [];
  for (let y = 0; y <= n; y++) {
    const nominal = a * (1 + nom) ** y;
    const deflator = (1 + inf) ** y;
    rows.push({ year: y, nominal: round2(nominal), real: round2(nominal / deflator), purchasingPowerOfAmount: round2(a / deflator) });
  }
  const last = rows[rows.length - 1];
  const realRate = round2((((1 + nom) / (1 + inf)) - 1) * 100);
  return {
    amount: round2(a),
    years: n,
    inflationRate: num(inflationRate),
    nominalRate: num(nominalRate),
    realRate,
    finalNominal: last.nominal,
    finalReal: last.real,
    lossOfPurchasingPower: round2(a - last.purchasingPowerOfAmount),
    beatsInflation: nom > inf,
    rows,
  };
}

export const TOOLS = { 'rendimiento-neto': netReturn, 'poder-adquisitivo': purchasingPower };

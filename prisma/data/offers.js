const TOOL_NAMES = {
  1: 'Diagnóstico financiero inicial',
  2: 'Mapa de productos financieros',
  3: 'Constructor de portafolio',
  4: 'Simulador de riesgo y exposición',
  5: 'Simulador de una operación',
  6: 'Laboratorio de gestión multiposición',
  7: 'Presupuesto y control financiero',
  8: 'Fondo de emergencia y liquidez',
  9: 'Panel de obligaciones y costo del dinero',
  10: 'Calculadora de rendimiento neto',
  11: 'Simulador de poder adquisitivo',
  12: 'Mi evolución patrimonial',
};

export const OFFERS = [
  {
    code: 'FULL_ANNUAL',
    name: 'Acceso completo anual',
    description: 'Academia + explicaciones + herramientas durante el periodo anual.',
    type: 'FULL_ANNUAL',
    moduleNumber: null,
    accessDays: 365,
    sortOrder: 0,
  },
  {
    code: 'TOOLS_ALL',
    name: 'Solo herramientas · M1–M12',
    description: 'Suscripción mensual a las 12 herramientas en un solo pago, sin la academia.',
    type: 'TOOL_ONLY',
    moduleNumber: null,
    accessDays: 30,
    sortOrder: 1,
  },
];

export const LEGACY_TOOL_OFFERS = Object.keys(TOOL_NAMES).map((n) => `TOOL_M${n}`);

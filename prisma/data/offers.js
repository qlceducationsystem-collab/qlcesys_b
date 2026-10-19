const TOOL_NAMES = {
  1: 'Diagnóstico financiero inicial',
  2: 'Mapa de productos financieros',
  3: 'Constructor de cartera',
  4: 'Simulador de riesgo y exposición',
  5: 'Simulador de una operación',
  6: 'Simulador de operación profesional',
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
  ...Object.entries(TOOL_NAMES).map(([n, name]) => ({
    code: `TOOL_M${n}`,
    name: `Herramienta M${n} · ${name}`,
    description: `Suscripción mensual a la herramienta del Módulo ${n}.`,
    type: 'TOOL_ONLY',
    moduleNumber: Number(n),
    accessDays: 30,
    sortOrder: Number(n),
  })),
];

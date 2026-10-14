// Redondeo monetario a 2 decimales evitando errores de punto flotante.
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Convierte Decimal de Prisma (o string/number) a Number.
export const num = (v) => (v === null || v === undefined ? 0 : Number(v));

export const sum = (items, pick) => round2(items.reduce((acc, it) => acc + num(pick(it)), 0));

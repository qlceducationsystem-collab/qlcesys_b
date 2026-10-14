export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const num = (v) => (v === null || v === undefined ? 0 : Number(v));

export const sum = (items, pick) => round2(items.reduce((acc, it) => acc + num(pick(it)), 0));

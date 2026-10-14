const norm = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();

  if (typeof v === 'object' && typeof v.toFixed === 'function' && 'd' in v && 'e' in v) return v.toString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const IGNORED = new Set(['createdAt', 'updatedAt', 'userId', 'id', 'updatedById']);

export function diffFields(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changes = [];
  for (const k of keys) {
    if (IGNORED.has(k)) continue;
    const a = norm(before?.[k]);
    const b = norm(after?.[k]);
    if (a !== b && !(a !== null && b !== null && Number(a) === Number(b) && !isNaN(Number(a)))) {
      changes.push({ field: k, oldValue: a, newValue: b });
    }
  }
  return changes;
}

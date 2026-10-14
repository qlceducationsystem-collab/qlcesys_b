// Fuente única del plan y precio. El monto se configura por variable de entorno
// para no repetir ni inventar cifras en el código.
export function getPlan() {
  const amount = Number(process.env.PLAN_AMOUNT);
  return {
    code: 'MONTHLY',
    name: process.env.PLAN_NAME || 'QLC Financial Education - Membresía mensual',
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: process.env.PLAN_CURRENCY || 'MXN',
    frequency: 1,
    frequencyType: 'months',
  };
}

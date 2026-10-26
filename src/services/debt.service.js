import { prisma } from '../config/prisma.js';
import { debtPayment, debtTotals } from '../domain/patrimonial.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { num } from '../utils/money.js';
import { absorbDiagnosisDebt, absorbExpenseChange, DIAGNOSIS_DEBT_SOURCE } from './moduleData.service.js';
import { getOpenPeriod, getPeriodSummary } from './period.service.js';

const flat = (b) => ({
  name: b.debt.name,
  lender: b.debt.lender,
  type: b.debt.type,
  annualRate: b.debt.annualRate,
  status: b.debt.status,
  balance: b.balance,
  payment: b.payment,
  fees: b.fees,
  periodId: b.periodId,
});

const debtFields = ({ name, lender, type, annualRate, status }) => ({ name, lender, type, annualRate, status });
const balanceFields = ({ balance, payment, fees }) => ({ balance, payment, fees });
const isDiagnosisDebt = (debt) => debt.source === DIAGNOSIS_DEBT_SOURCE;

function assertFees({ payment, fees }) {
  if (num(fees) > 0 && num(fees) >= num(payment)) {
    throw badRequest('Los cargos mensuales son la parte del pago que cubre comisiones o seguros: deben ser menores que el pago mensual. No repitas aquí el pago.');
  }
}

async function ownedBalance(userId, balanceId, db = prisma) {
  const bal = await db.debtBalance.findFirst({ where: { id: balanceId, debt: { userId } }, include: { debt: true } });
  if (!bal) throw notFound('Deuda no encontrada');
  return bal;
}

export async function debtOverview(userId, periodId) {
  const { period, summary } = await getPeriodSummary(userId, periodId);
  return {
    period,
    items: summary.debts.items,
    totals: debtTotals(summary.debts.items, summary.cashflow.income),
    balanceSheet: summary.balanceSheet,
  };
}

export async function createDebt(req, periodId, data) {
  assertFees(data);
  await getOpenPeriod(req.subjectId, periodId);
  return prisma.$transaction(async (tx) => {
    const debt = await tx.debt.create({ data: { userId: req.subjectId, ...debtFields(data) } });
    const created = await tx.debtBalance.create({ data: { debtId: debt.id, periodId, ...balanceFields(data) } });
    await absorbDiagnosisDebt(tx, { userId: req.subjectId, periodId, balance: num(data.balance), payment: num(data.payment) });
    return created;
  });
}

export async function updateDebt(req, balanceId, data) {
  const bal = await ownedBalance(req.subjectId, balanceId);
  await getOpenPeriod(req.subjectId, bal.periodId);
  assertFees(data);
  return prisma.$transaction(async (tx) => {
    await tx.debt.update({ where: { id: bal.debtId }, data: debtFields(data) });
    const updated = await tx.debtBalance.update({ where: { id: bal.id }, data: balanceFields(data), include: { debt: true } });
    if (!isDiagnosisDebt(bal.debt)) {
      await absorbDiagnosisDebt(tx, { userId: req.subjectId, periodId: bal.periodId, balance: num(data.balance) - num(bal.balance), payment: num(data.payment) - num(bal.payment) });
    }
    return updated;
  });
}

export async function deleteDebt(req, balanceId) {
  const bal = await ownedBalance(req.subjectId, balanceId);
  await getOpenPeriod(req.subjectId, bal.periodId);
  await prisma.$transaction(async (tx) => {
    await tx.debtBalance.delete({ where: { id: bal.id } });
    if (!(await tx.debtBalance.count({ where: { debtId: bal.debtId } }))) await tx.debt.delete({ where: { id: bal.debtId } });
    if (!isDiagnosisDebt(bal.debt)) await absorbDiagnosisDebt(tx, { userId: req.subjectId, periodId: bal.periodId, balance: -num(bal.balance), payment: -num(bal.payment) });
  });
}

export async function confirmPayment(req, balanceId, { amount, newBalance }) {
  const bal = await ownedBalance(req.subjectId, balanceId);
  await getOpenPeriod(req.subjectId, bal.periodId);
  if (newBalance !== undefined && newBalance !== null && Number(newBalance) > Number(bal.balance) + Number(amount)) {
    throw badRequest('El nuevo saldo no puede superar el saldo anterior más el pago');
  }
  const breakdown = debtPayment({ balance: bal.balance, annualRate: bal.debt.annualRate, fees: bal.fees, amount });
  const finalBalance = newBalance === undefined || newBalance === null ? breakdown.newBalance : Number(newBalance);
  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        userId: req.subjectId,
        periodId: bal.periodId,
        category: 'DEUDAS',
        description: `Pago confirmado · ${bal.debt.name}`,
        amount,
        source: 'M9_PAYMENT',
      },
    });
    await absorbExpenseChange(tx, req.subjectId, null, expense);
    const updated = await tx.debtBalance.update({ where: { id: bal.id }, data: { balance: finalBalance }, include: { debt: true } });
    return { expense, breakdown: { ...breakdown, newBalance: finalBalance }, balance: flat(updated) };
  });
}

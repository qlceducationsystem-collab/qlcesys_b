import { prisma } from '../config/prisma.js';
import { getPeriodSummary, latestClose } from './period.service.js';

const toRow = (period, s, source) => ({
  periodId: period.id,
  year: period.year,
  month: period.month,
  status: period.status,
  source,
  opening: s.patrimony.opening,
  final: s.patrimony.final,
  contributions: s.patrimony.contributions,
  withdrawals: s.patrimony.withdrawals,
  profitability: s.patrimony.profitability,
  roi: s.portfolio.global.roi,
  income: s.cashflow.income,
  expenses: s.cashflow.expenses,
  savings: s.cashflow.savings,
  liquidity: s.protection.total,
  debt: s.debts.totalBalance,
  netWorth: s.balanceSheet.netWorth,
  reconciled: s.reconciliation.reconciled,
});

export async function getHistory(userId, { year } = {}) {
  const periods = await prisma.financialPeriod.findMany({
    where: { userId, ...(year ? { year } : {}) },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });
  const rows = [];
  for (const p of periods) {
    const close = p.status === 'CLOSED' ? await latestClose(p.id) : null;
    if (close) rows.push(toRow(p, close.snapshot, 'CLOSE'));
    else rows.push(toRow(p, (await getPeriodSummary(userId, p.id)).summary, 'LIVE'));
  }
  return rows;
}

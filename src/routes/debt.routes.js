import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { ah } from '../utils/asyncHandler.js';
import { notFound } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.js';
import { debtSchema, periodQuery } from '../validations/schemas.js';
import { getOpenPeriod, getPeriodSummary } from '../services/period.service.js';
import { logAdminChange } from '../services/audit.service.js';

const r = Router();
const MODULE = 'DEUDAS';

async function ownedBalance(req) {
  const bal = await prisma.debtBalance.findFirst({
    where: { id: req.params.balanceId, debt: { userId: req.subjectId } },
    include: { debt: true },
  });
  if (!bal) throw notFound('Deuda no encontrada');
  return bal;
}

const flat = (b) => ({
  name: b.debt.name,
  lender: b.debt.lender,
  annualRate: b.debt.annualRate,
  status: b.debt.status,
  balance: b.balance,
  payment: b.payment,
  periodId: b.periodId,
});

r.get('/', validate(periodQuery, 'query'), ah(async (req, res) => {
  const { summary } = await getPeriodSummary(req.subjectId, req.validQuery.periodId);
  res.json(summary.debts);
}));

r.post('/', validate(debtSchema), ah(async (req, res) => {
  const { periodId, name, lender, annualRate, status, balance, payment } = req.body;
  await getOpenPeriod(req.subjectId, periodId);
  const bal = await prisma.$transaction(async (tx) => {
    const debt = await tx.debt.create({ data: { userId: req.subjectId, name, lender, annualRate, status } });
    const created = await tx.debtBalance.create({ data: { debtId: debt.id, periodId, balance, payment } });
    await logAdminChange(req, { module: MODULE, action: 'CREATE', entityId: created.id, after: req.body }, tx);
    return created;
  });
  res.status(201).json(bal);
}));

r.put('/:balanceId', validate(debtSchema), ah(async (req, res) => {
  const bal = await ownedBalance(req);
  await getOpenPeriod(req.subjectId, bal.periodId);
  const { name, lender, annualRate, status, balance, payment } = req.body;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.debt.update({ where: { id: bal.debtId }, data: { name, lender, annualRate, status } });
    const b = await tx.debtBalance.update({ where: { id: bal.id }, data: { balance, payment }, include: { debt: true } });
    await logAdminChange(req, { module: MODULE, action: 'UPDATE', entityId: bal.id, before: flat(bal), after: flat(b) }, tx);
    return b;
  });
  res.json(updated);
}));

r.delete('/:balanceId', ah(async (req, res) => {
  const bal = await ownedBalance(req);
  await getOpenPeriod(req.subjectId, bal.periodId);
  await prisma.$transaction(async (tx) => {
    await tx.debtBalance.delete({ where: { id: bal.id } });
    const remaining = await tx.debtBalance.count({ where: { debtId: bal.debtId } });
    if (!remaining) await tx.debt.delete({ where: { id: bal.debtId } });
    await logAdminChange(req, { module: MODULE, action: 'DELETE', entityId: bal.id, before: flat(bal) }, tx);
  });
  res.status(204).end();
}));

export default r;

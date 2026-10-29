import { Router } from 'express';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { debtPaymentSchema, debtSchema, periodQuery } from '../validations/schemas.js';
import * as debts from '../services/debt.service.js';

const r = Router();

r.get('/', validate(periodQuery, 'query'), ah(async (req, res) => {
  const { items, totals } = await debts.debtOverview(req.subjectId, req.validQuery.periodId);
  res.json({ items, totals, totalBalance: totals.balance, totalPayment: totals.payments, totalMonthlyInterest: totals.interest });
}));

r.post('/', validate(debtSchema), ah(async (req, res) => res.status(201).json(await debts.createDebt(req, req.body.periodId, req.body))));

r.put('/:balanceId', validate(debtSchema), ah(async (req, res) => res.json(await debts.updateDebt(req, req.params.balanceId, req.body))));

r.delete('/:balanceId', ah(async (req, res) => {
  await debts.deleteDebt(req, req.params.balanceId);
  res.status(204).end();
}));

r.post('/:balanceId/payments', validate(debtPaymentSchema), ah(async (req, res) => {
  res.status(201).json(await debts.confirmPayment(req, req.params.balanceId, req.body));
}));

r.delete('/:balanceId/payments', ah(async (req, res) => res.json(await debts.undoPayment(req, req.params.balanceId))));

export default r;

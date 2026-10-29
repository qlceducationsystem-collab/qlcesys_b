import { Router } from 'express';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import {
  budgetActualSchema, budgetActualSetSchema, budgetSchema, contributionSchema, debtFields, debtPaymentSchema, emergencyPlanSchema,
  monthQuery, patrimonialGoalSchema, reviewNoteSchema, scenarioSchema, taxItemSchema,
} from '../validations/schemas.js';
import { assertToolOpen } from '../services/academy.service.js';
import * as budget from '../services/budget.service.js';
import * as emergency from '../services/emergency.service.js';
import * as debts from '../services/debt.service.js';
import * as estimates from '../services/estimates.service.js';
import * as review from '../services/annualReview.service.js';
import { ensureWorkingPeriod, latestPeriod } from '../services/period.service.js';
import { annualReviewPdf } from '../pdf/annualReview.js';

const r = Router();
const tool = (n) => ah(async (req, res, next) => {
  await assertToolOpen(req, n);
  next();
});

r.get('/budget', tool(7), validate(monthQuery, 'query'), ah(async (req, res) => res.json(await budget.getBudget(req.subjectId, req.validQuery))));
r.get('/budget/history', tool(7), ah(async (req, res) => res.json(await budget.budgetHistory(req.subjectId))));
r.put('/budget', tool(7), validate(budgetSchema), ah(async (req, res) => res.json(await budget.saveBudget(req, req.body))));
r.post('/budget/actuals', tool(7), validate(budgetActualSchema), ah(async (req, res) => res.status(201).json(await budget.recordActual(req, req.body))));
r.post('/budget/confirm-real', tool(7), validate(monthQuery), ah(async (req, res) => res.json(await budget.confirmRealExpenses(req, req.body))));
r.put('/budget/actuals', tool(7), validate(budgetActualSetSchema), ah(async (req, res) => res.json(await budget.setActual(req, req.body))));

r.get('/emergency', tool(8), ah(async (req, res) => res.json(await emergency.getEmergency(req.subjectId))));
r.put('/emergency', tool(8), validate(emergencyPlanSchema), ah(async (req, res) => res.json(await emergency.savePlan(req, req.body))));
r.post('/emergency/contributions', tool(8), validate(contributionSchema), ah(async (req, res) => res.status(201).json(await emergency.addContribution(req, req.body))));
r.delete('/emergency/contributions/:id', tool(8), ah(async (req, res) => res.json(await emergency.deleteContribution(req, req.params.id))));

r.get('/obligations', tool(9), ah(async (req, res) => {
  const period = await latestPeriod(req.subjectId);
  res.json(period ? await debts.debtOverview(req.subjectId, period.id) : { period: null, items: [], totals: null });
}));
r.post('/obligations', tool(9), validate(debtFields), ah(async (req, res) => {
  const period = await ensureWorkingPeriod(req.subjectId);
  res.status(201).json(await debts.createDebt(req, period.id, req.body));
}));
r.put('/obligations/:balanceId', tool(9), validate(debtFields), ah(async (req, res) => res.json(await debts.updateDebt(req, req.params.balanceId, req.body))));
r.delete('/obligations/:balanceId', tool(9), ah(async (req, res) => {
  await debts.deleteDebt(req, req.params.balanceId);
  res.status(204).end();
}));
r.post('/obligations/:balanceId/payments', tool(9), validate(debtPaymentSchema), ah(async (req, res) => {
  res.status(201).json(await debts.confirmPayment(req, req.params.balanceId, req.body));
}));
r.delete('/obligations/:balanceId/payments', tool(9), ah(async (req, res) => res.json(await debts.undoPayment(req, req.params.balanceId))));

r.get('/tax-items', tool(10), ah(async (req, res) => res.json(await estimates.listTaxItems(req.subjectId))));
r.post('/tax-items', tool(10), validate(taxItemSchema), ah(async (req, res) => res.status(201).json(await estimates.taxItems.create(req, req.body))));
r.put('/tax-items/:id', tool(10), validate(taxItemSchema), ah(async (req, res) => res.json(await estimates.taxItems.update(req, req.params.id, req.body))));
r.delete('/tax-items/:id', tool(10), ah(async (req, res) => {
  await estimates.taxItems.remove(req, req.params.id);
  res.status(204).end();
}));

r.get('/scenarios', tool(11), ah(async (req, res) => res.json(await estimates.listScenarios(req.subjectId))));
r.post('/scenarios', tool(11), validate(scenarioSchema), ah(async (req, res) => res.status(201).json(await estimates.scenarios.create(req, req.body))));
r.put('/scenarios/:id', tool(11), validate(scenarioSchema), ah(async (req, res) => res.json(await estimates.scenarios.update(req, req.params.id, req.body))));
r.delete('/scenarios/:id', tool(11), ah(async (req, res) => {
  await estimates.scenarios.remove(req, req.params.id);
  res.status(204).end();
}));

r.get('/annual-review', tool(12), ah(async (req, res) => res.json(await review.buildAnnualReview(req.subjectId))));
r.get('/annual-review/pdf', tool(12), ah(async (req, res) => annualReviewPdf(res, await review.buildAnnualReview(req.subjectId))));
r.put('/annual-review/note', tool(12), validate(reviewNoteSchema), ah(async (req, res) => res.json(await review.saveNote(req, req.body.note))));
r.put('/annual-review/goal', tool(12), validate(patrimonialGoalSchema), ah(async (req, res) => res.json(await estimates.savePatrimonialGoal(req, req.body))));
r.post('/annual-review/save', tool(12), ah(async (req, res) => res.status(201).json(await review.saveReview(req))));
r.get('/annual-review/history', tool(12), ah(async (req, res) => res.json(await review.listReviews(req.subjectId))));
r.get('/annual-review/history/:id/pdf', tool(12), ah(async (req, res) => annualReviewPdf(res, await review.getReviewSnapshot(req.subjectId, req.params.id))));

export default r;

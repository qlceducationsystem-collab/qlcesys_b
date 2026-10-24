import { Router } from 'express';
import { ah } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { yearParam } from '../validations/schemas.js';
import * as annual from '../services/annual.service.js';
import { annualReportPdf } from '../pdf/reports.js';

const r = Router();
const year = (req) => yearParam.parse(req.params).year;

r.get('/', ah(async (req, res) => res.json(await annual.listAnnualReports(req.subjectId))));
r.get('/years', ah(async (req, res) => res.json(await annual.closedYears(req.subjectId))));

r.post('/:year/generate', ah(async (req, res) => {
  res.status(201).json(await annual.generateAnnualReport(req.subjectId, year(req)));
}));

r.get('/:year', ah(async (req, res) => res.json(await annual.getAnnualReport(req.subjectId, year(req)))));
r.get('/:year/pdf', ah(async (req, res) => annualReportPdf(res, await annual.getAnnualReport(req.subjectId, year(req)))));

export default r;

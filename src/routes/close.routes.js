import { Router } from 'express';
import { ah } from '../utils/asyncHandler.js';
import { getClose, listCloses } from '../services/close.service.js';
import { monthlyClosePdf } from '../pdf/reports.js';

const r = Router();

r.get('/', ah(async (req, res) => res.json(await listCloses(req.subjectId))));
r.get('/:id', ah(async (req, res) => res.json(await getClose(req.subjectId, req.params.id))));
r.get('/:id/pdf', ah(async (req, res) => monthlyClosePdf(res, await getClose(req.subjectId, req.params.id))));

export default r;

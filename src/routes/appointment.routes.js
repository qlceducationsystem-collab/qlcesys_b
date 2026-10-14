import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { ah } from '../utils/asyncHandler.js';
import { conflict, notFound } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.js';
import { appointmentSchema } from '../validations/schemas.js';
import { logAdminChange } from '../services/audit.service.js';

const r = Router();

r.get('/', ah(async (req, res) => {
  res.json(await prisma.appointment.findMany({ where: { userId: req.subjectId }, orderBy: { scheduledAt: 'desc' } }));
}));

r.post('/', validate(appointmentSchema), ah(async (req, res) => {
  const row = await prisma.appointment.create({ data: { ...req.body, userId: req.subjectId } });
  await logAdminChange(req, { module: 'ASESORIA', action: 'CREATE', entityId: row.id, after: row });
  res.status(201).json(row);
}));

r.post('/:id/cancel', ah(async (req, res) => {
  const appt = await prisma.appointment.findFirst({ where: { id: req.params.id, userId: req.subjectId } });
  if (!appt) throw notFound('Cita no encontrada');
  if (['COMPLETED', 'CANCELLED'].includes(appt.status)) throw conflict('La cita ya no puede cancelarse');
  const row = await prisma.appointment.update({ where: { id: appt.id }, data: { status: 'CANCELLED' } });
  await logAdminChange(req, { module: 'ASESORIA', action: 'UPDATE', entityId: row.id, before: appt, after: row });
  res.json(row);
}));

export default r;

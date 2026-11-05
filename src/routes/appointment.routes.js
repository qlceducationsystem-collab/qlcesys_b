import { Router } from 'express';
import { actorOf, recordEvent } from '../services/adminEvent.service.js';
import { consumeCredits, releaseCredits, SESSION_MINUTES } from '../services/credit.service.js';
import { prisma } from '../config/prisma.js';
import { ah } from '../utils/asyncHandler.js';
import { conflict, notFound } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.js';
import { appointmentSchema } from '../validations/schemas.js';

const r = Router();

r.get('/', ah(async (req, res) => {
  res.json(await prisma.appointment.findMany({ where: { userId: req.subjectId }, orderBy: { scheduledAt: 'desc' } }));
}));

r.post('/', validate(appointmentSchema), ah(async (req, res) => {
  const appt = await prisma.$transaction(async (tx) => {
    const row = await tx.appointment.create({ data: { ...req.body, userId: req.subjectId } });
    if (!req.asAdmin) await consumeCredits(tx, req.subjectId, 'ORIENTACION', Math.max(1, Math.ceil((row.durationMin || SESSION_MINUTES) / SESSION_MINUTES)), row.id);
    return row;
  });
  const client = await prisma.user.findUnique({ where: { id: req.subjectId } });
  recordEvent({ category: 'PLATAFORMA', type: 'NUEVA_CITA', actor: actorOf(req.user), user: client, status: appt.reason || null, result: `${new Date(appt.scheduledAt).toISOString().replace('T', ' ').slice(0, 16)} UTC · ${appt.durationMin || ''} min` }).catch(() => null);
  res.status(201).json(appt);
}));

r.post('/:id/cancel', ah(async (req, res) => {
  const appt = await prisma.appointment.findFirst({ where: { id: req.params.id, userId: req.subjectId } });
  if (!appt) throw notFound('Cita no encontrada');
  if (['COMPLETED', 'CANCELLED'].includes(appt.status)) throw conflict('La cita ya no puede cancelarse');
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.appointment.update({ where: { id: appt.id }, data: { status: 'CANCELLED' } });
    await releaseCredits(tx, appt.id);
    return row;
  });
  const client = await prisma.user.findUnique({ where: { id: req.subjectId } });
  recordEvent({ category: 'PLATAFORMA', type: 'CITA_CANCELADA', actor: actorOf(req.user), user: client, status: 'Cancelada', result: `${new Date(appt.scheduledAt).toISOString().replace('T', ' ').slice(0, 16)} UTC` }).catch(() => null);
  res.json(updated);
}));

export default r;

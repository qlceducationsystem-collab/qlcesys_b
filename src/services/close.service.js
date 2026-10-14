import { prisma } from '../config/prisma.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { assertOpen, getPeriodSummary, latestClose } from './period.service.js';
import { logAdminChange } from './audit.service.js';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const periodLabel = (y, m) => `${MONTHS[m - 1]} ${y}`;

/**
 * Cierra un periodo: valida conciliación, guarda snapshot inmutable y marca CLOSED.
 * Todo en una transacción.
 */
export async function closePeriod(req, periodId) {
  const userId = req.subjectId;
  return prisma.$transaction(async (tx) => {
    const { period, data, summary } = await getPeriodSummary(userId, periodId, tx);
    assertOpen(period);
    if (!summary.reconciliation.reconciled) {
      throw badRequest('INFORMACIÓN NO CONCILIADA: corrige la diferencia antes de cerrar el periodo', summary.reconciliation);
    }
    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    const last = await tx.monthlyClose.findFirst({ where: { periodId }, orderBy: { revision: 'desc' } });
    const revision = (last?.revision || 0) + 1;
    const snapshot = {
      user,
      period: { id: period.id, year: period.year, month: period.month, label: periodLabel(period.year, period.month) },
      revision,
      closedAt: new Date().toISOString(),
      ...summary,
      movements: data.movements.map((m) => ({
        type: m.type, amount: Number(m.amount), date: m.date, description: m.description,
      })),
    };
    const close = await tx.monthlyClose.create({
      data: { userId, periodId, revision, year: period.year, month: period.month, snapshot, closedById: req.user.id },
    });
    await tx.financialPeriod.update({ where: { id: periodId }, data: { status: 'CLOSED' } });
    await logAdminChange(req, { module: 'CORTES', action: 'CLOSE_PERIOD', entityId: close.id, after: { periodId, revision } }, tx);
    return close;
  });
}

// Solo ADMIN: reabre un periodo cerrado conservando la revisión anterior.
export async function reopenPeriod(req, periodId, reason) {
  return prisma.$transaction(async (tx) => {
    const period = await tx.financialPeriod.findFirst({ where: { id: periodId, userId: req.subjectId } });
    if (!period) throw notFound('Periodo no encontrado');
    if (period.status !== 'CLOSED') throw conflict('El periodo no está cerrado');
    const close = await latestClose(periodId, tx);
    if (close) await tx.monthlyClose.update({ where: { id: close.id }, data: { supersededAt: new Date() } });
    await tx.financialPeriod.update({ where: { id: periodId }, data: { status: 'OPEN' } });
    await logAdminChange(
      req,
      { module: 'CORTES', action: 'UPDATE', entityId: periodId, before: { status: 'CLOSED' }, after: { status: 'OPEN' }, reason },
      tx,
    );
    return { ok: true };
  });
}

export const listCloses = (userId) =>
  prisma.monthlyClose.findMany({
    where: { userId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }, { revision: 'desc' }],
    select: { id: true, periodId: true, year: true, month: true, revision: true, closedAt: true, supersededAt: true, snapshot: true },
  });

export async function getClose(userId, closeId) {
  const close = await prisma.monthlyClose.findFirst({ where: { id: closeId, userId } });
  if (!close) throw notFound('Corte no encontrado');
  return close;
}

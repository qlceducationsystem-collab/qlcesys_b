import { prisma } from '../config/prisma.js';
import { annualEvolution, annualWindow, goalProgress, monthKey, shiftMonth, whatChanged } from '../domain/patrimonial.js';
import { annualReviewPdf, reviewFilename } from '../pdf/annualReview.js';
import { pdfBuffer } from '../pdf/layout.js';
import { conflict, notFound } from '../utils/httpError.js';
import { num } from '../utils/money.js';
import { patrimonialGoal } from './estimates.service.js';
import { getPeriodSummary, latestClose } from './period.service.js';
import { driveConnected, uploadBuffer } from './google/drive.js';

const toDate = (ymd) => new Date(`${ymd}T00:00:00.000Z`);

async function monthSummaries(userId, window) {
  const wanted = [shiftMonth(window.start, -1), ...window.months];
  const periods = await prisma.financialPeriod.findMany({
    where: { userId, OR: wanted.map(({ year, month }) => ({ year, month })) },
  });
  const entries = await Promise.all(
    periods.map(async (p) => {
      const close = p.status === 'CLOSED' ? await latestClose(p.id) : null;
      const summary = close ? close.snapshot : (await getPeriodSummary(userId, p.id)).summary;
      return [monthKey(p), { summary, status: p.status, source: close ? 'CLOSE' : 'LIVE' }];
    }),
  );
  return new Map(entries);
}

const noteView = (n) => n && { note: n.note, updatedAt: n.updatedAt };

export async function buildAnnualReview(userId, now = new Date()) {
  const window = annualWindow(now);
  const [months, goal, note, user, saved] = await Promise.all([
    monthSummaries(userId, window),
    patrimonialGoal(userId),
    prisma.annualReviewNote.findUnique({ where: { userId_periodEnd: { userId, periodEnd: toDate(window.endDate) } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.annualReview.findUnique({ where: { userId_periodEnd: { userId, periodEnd: toDate(window.endDate) } }, select: { id: true, generatedAt: true, driveFileId: true } }),
  ]);
  const evolution = annualEvolution(window, months);
  const progress = evolution.hasData && goal ? goalProgress(goal.targetAmount, evolution.change.finalNetWorth) : null;
  return {
    ...evolution,
    currency: 'MXN',
    generatedAt: new Date().toISOString(),
    user,
    goal,
    goalProgress: progress,
    note: noteView(note),
    changes: whatChanged(evolution, progress),
    saved,
  };
}

export async function saveNote(req, note) {
  const userId = req.subjectId;
  const window = annualWindow();
  const key = { userId, periodEnd: toDate(window.endDate) };
  const row = await prisma.annualReviewNote.upsert({
    where: { userId_periodEnd: key },
    create: { ...key, periodStart: toDate(window.startDate), note },
    update: { note },
  });
  return noteView(row);
}

const decimalOrNull = (v) => (v === null || v === undefined ? null : v);

async function storeInDrive(review, report) {
  if (!(await driveConnected())) return null;
  try {
    const buffer = await pdfBuffer((stream) => annualReviewPdf(stream, report));
    const file = await uploadBuffer({ buffer, name: reviewFilename(report), mimeType: 'application/pdf', kind: 'REPORT', moduleNumber: 12 });
    return prisma.annualReview.update({ where: { id: review.id }, data: { driveFileId: file.id, pdfName: file.name, pdfMimeType: 'application/pdf' } });
  } catch (err) {
    console.error('[annual-review] PDF no almacenado en Drive:', err.message);
    return null;
  }
}

export async function saveReview(req) {
  const userId = req.subjectId;
  const report = await buildAnnualReview(userId);
  if (report.saved) throw conflict('Ya guardaste la revisión de este periodo. El histórico no se recalcula con datos actuales.');
  const c = report.change || {};
  const review = await prisma.annualReview.create({
    data: {
      userId,
      periodStart: toDate(report.window.startDate),
      periodEnd: toDate(report.window.endDate),
      complete: report.complete,
      initialAssets: decimalOrNull(c.initialAssets),
      finalAssets: decimalOrNull(c.finalAssets),
      initialDebts: decimalOrNull(c.initialDebts),
      finalDebts: decimalOrNull(c.finalDebts),
      initialNetWorth: decimalOrNull(c.initialNetWorth),
      finalNetWorth: decimalOrNull(c.finalNetWorth),
      variation: decimalOrNull(c.variation),
      variationPercent: decimalOrNull(c.variationPercent),
      goalAmount: decimalOrNull(report.goalProgress?.goal),
      goalProgress: decimalOrNull(report.goalProgress?.progress),
      snapshot: { ...report, saved: null },
    },
  });
  const stored = await storeInDrive(review, report);
  return reviewView(stored || review);
}

const reviewView = (r) => ({
  id: r.id,
  periodStart: r.periodStart,
  periodEnd: r.periodEnd,
  generatedAt: r.generatedAt,
  complete: r.complete,
  initialNetWorth: r.initialNetWorth === null ? null : num(r.initialNetWorth),
  finalNetWorth: r.finalNetWorth === null ? null : num(r.finalNetWorth),
  variation: r.variation === null ? null : num(r.variation),
  variationPercent: r.variationPercent === null ? null : num(r.variationPercent),
  goalProgress: r.goalProgress === null ? null : num(r.goalProgress),
  storedInDrive: !!r.driveFileId,
});

export const listReviews = async (userId) =>
  (await prisma.annualReview.findMany({ where: { userId }, orderBy: { periodEnd: 'desc' } })).map(reviewView);

export async function getReviewSnapshot(userId, id) {
  const review = await prisma.annualReview.findFirst({ where: { id, userId } });
  if (!review) throw notFound('Revisión no encontrada');
  return { ...review.snapshot, generatedAt: review.generatedAt.toISOString() };
}

export const latestReview = async (userId) => {
  const r = await prisma.annualReview.findFirst({ where: { userId }, orderBy: { periodEnd: 'desc' } });
  return r && reviewView(r);
};

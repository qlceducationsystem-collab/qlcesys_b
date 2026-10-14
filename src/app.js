import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { apiLimiter } from './middlewares/rateLimit.js';
import { authenticate, privateAccess, requireRole } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/error.js';
import authRoutes from './routes/auth.routes.js';
import subscriptionRoutes from './routes/subscription.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import adminRoutes from './routes/admin.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import periodRoutes from './routes/period.routes.js';
import portfolioRoutes from './routes/portfolio.routes.js';
import debtRoutes from './routes/debt.routes.js';
import closeRoutes from './routes/close.routes.js';
import annualRoutes from './routes/annual.routes.js';
import academyRoutes from './routes/academy.routes.js';
import appointmentRoutes from './routes/appointment.routes.js';
import { businessRouter } from './routes/business.routes.js';
import { expensesRouter, incomesRouter, movementsRouter, protectionRouter } from './routes/finance.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Render está detrás de un proxy
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.frontendUrls.includes(origin)),
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Id'],
      exposedHeaders: ['Content-Disposition'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  );
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Públicas / autenticación
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api', apiLimiter);
  app.use('/api/subscriptions', subscriptionRoutes);

  // Panel administrativo
  app.use('/api/admin', authenticate, requireRole('ADMIN'), adminRoutes);

  // Área privada: cliente con membresía activa, o admin gestionando a un cliente (X-Client-Id).
  const priv = (path, router) => app.use(path, ...privateAccess, router);
  priv('/api/dashboard', dashboardRoutes);
  priv('/api/periods', periodRoutes);
  priv('/api/portfolio', portfolioRoutes);
  priv('/api/incomes', incomesRouter);
  priv('/api/expenses', expensesRouter);
  priv('/api/protection', protectionRouter);
  priv('/api/debts', debtRoutes);
  priv('/api/patrimonial-movements', movementsRouter);
  priv('/api/business', businessRouter);
  priv('/api/monthly-closes', closeRoutes);
  priv('/api/annual-reports', annualRoutes);
  priv('/api/academy', academyRoutes);
  priv('/api/appointments', appointmentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

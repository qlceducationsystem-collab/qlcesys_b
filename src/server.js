import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { startKeepAlive } from './services/keepAlive.service.js';
import { flushAnalytics, startAnalyticsFlush } from './services/analytics.service.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.info(`[qlc] API escuchando en el puerto ${env.port} (${process.env.NODE_ENV || 'development'})`);
});

const keepAlive = startKeepAlive();
const analyticsFlush = startAnalyticsFlush();

async function shutdown(signal) {
  console.info(`[qlc] ${signal} recibido, cerrando...`);
  if (keepAlive) clearInterval(keepAlive);
  if (analyticsFlush) clearInterval(analyticsFlush);
  server.close(async () => {
    await flushAnalytics();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

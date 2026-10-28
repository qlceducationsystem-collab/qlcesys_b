import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { startKeepAlive } from './services/keepAlive.service.js';
import { reconcileDiagnosisBreakdown } from './services/moduleData.service.js';
import { startIncomeJob } from './services/productIncome.service.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.info(`[qlc] API escuchando en el puerto ${env.port} (${process.env.NODE_ENV || 'development'})`);
});

const keepAlive = startKeepAlive();
const incomeJob = startIncomeJob();

reconcileDiagnosisBreakdown()
  .then((periods) => periods && console.info(`[qlc] desglose del diagnóstico conciliado en ${periods} periodos`))
  .catch((err) => console.error('[qlc] no se pudo conciliar el desglose del diagnóstico', err.message));

async function shutdown(signal) {
  console.info(`[qlc] ${signal} recibido, cerrando...`);
  if (keepAlive) clearInterval(keepAlive);
  clearInterval(incomeJob);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

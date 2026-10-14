// Seed idempotente y NO destructivo: solo crea/actualiza catálogos y el admin inicial.
// Nunca borra datos de usuarios.
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { CATEGORIES } from './data/categories.js';
import { MODULES } from './data/academy.js';

const prisma = new PrismaClient();

async function main() {
  for (const c of CATEGORIES) {
    await prisma.assetCategory.upsert({ where: { code: c.code }, create: c, update: { name: c.name, riskLevel: c.riskLevel, sortOrder: c.sortOrder } });
  }
  for (const m of MODULES) {
    await prisma.academyModule.upsert({ where: { month: m.month }, create: m, update: m });
  }

  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const email = ADMIN_EMAIL.trim().toLowerCase();
    const exists = await prisma.user.findUnique({ where: { email } });
    if (!exists) {
      if (ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres');
      await prisma.user.create({
        data: { email, name: ADMIN_NAME || 'Administrador QLC', role: 'ADMIN', adminLevel: 'FULL', passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12) },
      });
      console.info(`[seed] Administrador creado: ${email}`);
    }
  }
  console.info(`[seed] ${CATEGORIES.length} categorías y ${MODULES.length} módulos sincronizados`);
}

main()
  .catch((err) => {
    console.error('[seed] error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

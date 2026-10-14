import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { CATEGORIES } from './data/categories.js';
import { MODULES } from './data/academy.js';
import { OFFERS } from './data/offers.js';
import { PUBLIC_SECTIONS } from './data/publicSections.js';

const prisma = new PrismaClient();

async function seedCatalogs() {
  for (const c of CATEGORIES) {
    await prisma.assetCategory.upsert({ where: { code: c.code }, create: c, update: { name: c.name, riskLevel: c.riskLevel, sortOrder: c.sortOrder } });
  }
  for (const m of MODULES) {
    await prisma.academyModule.upsert({ where: { month: m.month }, create: m, update: m });
  }
}

async function seedEditableContent() {
  for (const offer of OFFERS) {
    await prisma.productOffer.upsert({ where: { code: offer.code }, create: offer, update: {} });
  }
  for (const [position, section] of PUBLIC_SECTIONS.entries()) {
    await prisma.publicSection.upsert({ where: { key: section.key }, create: { ...section, position }, update: {} });
  }
}

async function seedAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const email = ADMIN_EMAIL.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) return;
  if (ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres');
  await prisma.user.create({
    data: { email, name: ADMIN_NAME || 'Administrador QLC', role: 'ADMIN', adminLevel: 'FULL', passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12) },
  });
  console.info(`[seed] Administrador creado: ${email}`);
}

async function main() {
  await seedCatalogs();
  await seedEditableContent();
  await seedAdmin();
  console.info(`[seed] ${CATEGORIES.length} categorías, ${MODULES.length} módulos, ${OFFERS.length} ofertas y ${PUBLIC_SECTIONS.length} secciones sincronizadas`);
}

main()
  .catch((err) => {
    console.error('[seed] error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

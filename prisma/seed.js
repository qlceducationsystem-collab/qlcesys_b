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

const ADMIN_ACCOUNTS = ['ADMIN', 'OWNER_ADMIN'];

async function seedAdmin(prefix) {
  const email = process.env[`${prefix}_EMAIL`]?.trim().toLowerCase();
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) return;
  if (await prisma.user.findUnique({ where: { email } })) return;
  if (password.length < 12) throw new Error(`${prefix}_PASSWORD debe tener al menos 12 caracteres`);
  await prisma.user.create({
    data: { email, name: process.env[`${prefix}_NAME`] || 'Administrador QLC', role: 'ADMIN', adminLevel: 'FULL', passwordHash: await bcrypt.hash(password, 12) },
  });
  console.info(`[seed] Administrador creado: ${email}`);
}

async function main() {
  await seedCatalogs();
  await seedEditableContent();
  for (const prefix of ADMIN_ACCOUNTS) await seedAdmin(prefix);
  console.info(`[seed] ${CATEGORIES.length} categorías, ${MODULES.length} módulos, ${OFFERS.length} ofertas y ${PUBLIC_SECTIONS.length} secciones sincronizadas`);
}

main()
  .catch((err) => {
    console.error('[seed] error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

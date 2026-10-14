import { prisma } from '../config/prisma.js';
import { notFound } from '../utils/httpError.js';
import { listOffers } from './access.service.js';
import { releaseImage, storeImage } from './cloudinary.service.js';
import { logPublicChange } from './audit.service.js';

const imageView = (m) => m && { id: m.id, url: m.secureUrl, width: m.width, height: m.height, format: m.format };

const sectionView = ({ image, imageId: _imageId, updatedById: _u, createdAt: _c, id: _id, ...rest }) => ({ ...rest, image: imageView(image) });

export const listSections = async ({ includeInactive = false } = {}) =>
  (await prisma.publicSection.findMany({
    where: includeInactive ? {} : { active: true },
    include: { image: true },
    orderBy: { position: 'asc' },
  })).map(sectionView);

export async function publicContent() {
  const [sections, offers] = await Promise.all([listSections(), listOffers()]);
  return { sections, offers, generatedAt: new Date().toISOString() };
}

export async function updateSection(adminId, key, data) {
  const before = await prisma.publicSection.findUnique({ where: { key } });
  if (!before) throw notFound('Sección no encontrada');
  const updated = await prisma.publicSection.update({ where: { key }, data: { ...data, updatedById: adminId }, include: { image: true } });
  await logPublicChange(adminId, key, before, updated);
  return sectionView(updated);
}

export async function replaceSectionImage(adminId, key, file) {
  const section = await prisma.publicSection.findUnique({ where: { key } });
  if (!section) throw notFound('Sección no encontrada');
  const media = await storeImage(file, { purpose: 'publico', uploadedById: adminId });
  const updated = await prisma.publicSection.update({ where: { key }, data: { imageId: media.id, updatedById: adminId }, include: { image: true } });
  await releaseImage(section.imageId);
  return sectionView(updated);
}

export async function removeSectionImage(adminId, key) {
  const section = await prisma.publicSection.findUnique({ where: { key } });
  if (!section) throw notFound('Sección no encontrada');
  const updated = await prisma.publicSection.update({ where: { key }, data: { imageId: null, updatedById: adminId }, include: { image: true } });
  await releaseImage(section.imageId);
  return sectionView(updated);
}

export async function reorderSections(keys) {
  await prisma.$transaction(keys.map((key, position) => prisma.publicSection.update({ where: { key }, data: { position } })));
  return listSections({ includeInactive: true });
}

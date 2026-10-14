import fs from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { canReadAcademy } from '../domain/access.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import { kindOf } from '../middlewares/upload.js';
import { accessFor } from './access.service.js';
import { destroyImage, uploadBuffer } from './cloudinary.service.js';
import { deleteFile, streamFile, uploadFile } from './google/drive.js';

const view = (m) => ({
  id: m.id,
  moduleNumber: m.module?.month,
  fileType: m.fileType,
  provider: m.provider,
  providerFileId: m.providerFileId,
  url: m.url,
  name: m.name,
  mimeType: m.mimeType,
  size: m.size,
  position: m.position,
  active: m.active,
  createdAt: m.createdAt,
});

export const listModuleMedia = async (moduleNumber) =>
  (await prisma.moduleMedia.findMany({
    where: moduleNumber ? { module: { month: moduleNumber } } : {},
    include: { module: { select: { month: true } } },
    orderBy: [{ moduleId: 'asc' }, { position: 'asc' }],
  })).map(view);

export async function uploadModuleMedia({ moduleNumber, file, adminId }) {
  const mod = await prisma.academyModule.findUnique({ where: { month: moduleNumber } });
  if (!mod) throw notFound('Módulo no encontrado');
  const fileType = kindOf(file.mimetype);
  if (!fileType) throw badRequest('Tipo de archivo no permitido');
  try {
    let stored;
    if (fileType === 'IMAGE') {
      const result = await uploadBuffer(await fs.readFile(file.path), `modulos/modulo-${moduleNumber}`);
      stored = { provider: 'CLOUDINARY', providerFileId: result.public_id, url: result.secure_url };
    } else {
      const result = await uploadFile({ filePath: file.path, name: file.originalname, mimeType: file.mimetype, size: file.size, kind: fileType, moduleNumber });
      stored = { provider: 'GOOGLE_DRIVE', providerFileId: result.id, url: null };
    }
    const position = await prisma.moduleMedia.count({ where: { moduleId: mod.id } });
    const row = await prisma.moduleMedia.create({
      data: { moduleId: mod.id, fileType, ...stored, name: file.originalname, mimeType: file.mimetype, size: file.size, position, uploadedById: adminId },
      include: { module: { select: { month: true } } },
    });
    return view(row);
  } finally {
    await fs.unlink(file.path).catch(() => null);
  }
}

export async function updateModuleMedia(id, data) {
  return view(await prisma.moduleMedia.update({ where: { id }, data, include: { module: { select: { month: true } } } }));
}

export async function deleteModuleMedia(id) {
  const media = await prisma.moduleMedia.findUnique({ where: { id } });
  if (!media) throw notFound('Archivo no encontrado');
  if (media.provider === 'CLOUDINARY') await destroyImage(media.providerFileId);
  else await deleteFile(media.providerFileId);
  await prisma.moduleMedia.delete({ where: { id } });
}

export async function createMediaLink(req, id) {
  const media = await prisma.moduleMedia.findUnique({ where: { id } });
  if (!media || (!media.active && req.user.role !== 'ADMIN')) throw notFound('Archivo no encontrado');
  if (req.user.role !== 'ADMIN' && !canReadAcademy(await accessFor(req))) throw forbidden('Contenido disponible con el acceso completo');
  if (media.provider === 'CLOUDINARY') return { url: media.url };
  const token = jwt.sign({ mid: id, sub: req.user.id }, env.jwtSecret, { expiresIn: '2h' });
  return { url: `${env.backendUrl}/api/media/${id}?t=${token}` };
}

export async function streamWithToken(id, token, range, res) {
  let payload;
  try {
    payload = jwt.verify(String(token || ''), env.jwtSecret);
  } catch {
    throw forbidden('Enlace expirado');
  }
  if (payload.mid !== id) throw forbidden('Enlace no válido');
  const media = await prisma.moduleMedia.findUnique({ where: { id } });
  if (!media || media.provider !== 'GOOGLE_DRIVE') throw notFound('Archivo no encontrado');
  const disposition = media.fileType === 'VIDEO' ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(media.name)}`);
  return streamFile(media.providerFileId, range, res);
}

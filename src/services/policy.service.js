import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '../config/prisma.js';
import { cloudinaryConfigured, env } from '../config/env.js';
import { HttpError, badRequest, notFound } from '../utils/httpError.js';
import { getOpenPeriod } from './period.service.js';

const INSURANCE = ['SEGURO_GASTOS_MEDICOS', 'SEGURO_VIDA', 'SEGURO_AUTO', 'SEGURO_DESEMPLEO', 'SEGURO_EDUCACION', 'OTRO_SEGURO'];
export const POLICY_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function client() {
  if (!cloudinaryConfigured()) throw new HttpError(503, 'La carga de pólizas aún no está disponible: falta configurar el almacenamiento de archivos.');
  cloudinary.config({ cloud_name: env.cloudinary.cloudName, api_key: env.cloudinary.apiKey, api_secret: env.cloudinary.apiSecret, secure: true });
  return cloudinary;
}

async function ownedInsurance(userId, recordId) {
  const record = await prisma.protectionRecord.findFirst({ where: { id: recordId, userId } });
  if (!record || !INSURANCE.includes(record.type)) throw notFound('Seguro no encontrado');
  return record;
}

const upload = (buffer, folder) => new Promise((resolve, reject) => {
  const stream = client().uploader.upload_stream(
    { folder: `${env.cloudinary.folder}/${folder}`, resource_type: 'image', type: 'private', overwrite: false },
    (err, result) => (err ? reject(new HttpError(502, `No se pudo guardar la póliza: ${err.message}`)) : resolve(result)),
  );
  stream.end(buffer);
});

async function release(recordId, publicId) {
  const shared = await prisma.protectionRecord.count({ where: { policyFileId: publicId, NOT: { id: recordId } } });
  if (!shared) await client().uploader.destroy(publicId, { resource_type: 'image', type: 'private' }).catch(() => null);
}

export async function attachPolicy(req, recordId, file) {
  if (!file) throw badRequest('Selecciona el archivo de tu póliza');
  const record = await ownedInsurance(req.subjectId, recordId);
  await getOpenPeriod(req.subjectId, record.periodId);
  const result = await upload(file.buffer, `polizas/${req.subjectId}`);
  if (record.policyFileId) await release(record.id, record.policyFileId);
  return prisma.protectionRecord.update({
    where: { id: record.id },
    data: { policyFileId: result.public_id, policyFileName: file.originalname.slice(0, 200), policyFileFormat: result.format },
  });
}

export async function policyUrl(req, recordId) {
  const record = await ownedInsurance(req.subjectId, recordId);
  if (!record.policyFileId) throw notFound('Este seguro no tiene póliza cargada');
  return client().utils.private_download_url(record.policyFileId, record.policyFileFormat || 'pdf', { resource_type: 'image', type: 'private', expires_at: Math.floor(Date.now() / 1000) + 300 });
}

export async function removePolicy(req, recordId) {
  const record = await ownedInsurance(req.subjectId, recordId);
  await getOpenPeriod(req.subjectId, record.periodId);
  if (record.policyFileId) await release(record.id, record.policyFileId);
  return prisma.protectionRecord.update({ where: { id: record.id }, data: { policyFileId: null, policyFileName: null, policyFileFormat: null } });
}

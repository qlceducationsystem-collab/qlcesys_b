import { v2 as cloudinary } from 'cloudinary';
import { prisma } from '../config/prisma.js';
import { cloudinaryConfigured, env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

let configured = false;

function client() {
  if (!cloudinaryConfigured()) throw new HttpError(503, 'Cloudinary no está configurado en el servidor');
  if (!configured) {
    cloudinary.config({ cloud_name: env.cloudinary.cloudName, api_key: env.cloudinary.apiKey, api_secret: env.cloudinary.apiSecret, secure: true });
    configured = true;
  }
  return cloudinary;
}

export function uploadBuffer(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = client().uploader.upload_stream(
      { folder: `${env.cloudinary.folder}/${folder}`, resource_type: 'image', overwrite: false },
      (err, result) => (err ? reject(new HttpError(502, `Cloudinary rechazó la imagen: ${err.message}`)) : resolve(result)),
    );
    stream.end(buffer);
  });
}

export async function destroyImage(publicId) {
  try {
    await client().uploader.destroy(publicId, { resource_type: 'image' });
  } catch (err) {
    console.error('[cloudinary] no se pudo eliminar', publicId, err.message);
  }
}

export async function storeImage(file, { purpose, uploadedById }) {
  const result = await uploadBuffer(file.buffer, purpose);
  return prisma.mediaAsset.create({
    data: {
      publicId: result.public_id,
      secureUrl: result.secure_url,
      width: result.width,
      height: result.height,
      format: result.format,
      resourceType: result.resource_type,
      bytes: result.bytes,
      purpose,
      uploadedById,
    },
  });
}

export async function releaseImage(mediaId) {
  if (!mediaId) return;
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId }, include: { _count: { select: { sections: true } } } });
  if (!media || media._count.sections > 0) return;
  await destroyImage(media.publicId);
  await prisma.mediaAsset.delete({ where: { id: mediaId } });
}

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

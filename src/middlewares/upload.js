import os from 'node:os';
import multer from 'multer';
import { badRequest } from '../utils/httpError.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

export const FILE_KINDS = { IMAGE: IMAGE_TYPES, VIDEO: VIDEO_TYPES, DOCUMENT: DOCUMENT_TYPES };

const filter = (allowed) => (_req, file, cb) => (allowed.includes(file.mimetype) ? cb(null, true) : cb(badRequest('Tipo de archivo no permitido')));


export const moduleFileUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: filter([...IMAGE_TYPES, ...VIDEO_TYPES, ...DOCUMENT_TYPES]),
}).single('file');

export const kindOf = (mimetype) => Object.entries(FILE_KINDS).find(([, types]) => types.includes(mimetype))?.[0];

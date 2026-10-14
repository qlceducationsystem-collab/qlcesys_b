import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';

export const notFoundHandler = (req, res) => res.status(404).json({ error: 'Ruta no encontrada' });

const MULTER_MESSAGES = { LIMIT_FILE_SIZE: 'El archivo supera el tamaño permitido', LIMIT_UNEXPECTED_FILE: 'Archivo no esperado' };

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Datos inválidos',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err?.name === 'MulterError') return res.status(400).json({ error: MULTER_MESSAGES[err.code] || 'Archivo no válido' });
  if (err?.code === 'P2002') return res.status(409).json({ error: 'El registro ya existe' });
  if (err?.code === 'P2025') return res.status(404).json({ error: 'Recurso no encontrado' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err?.message || err);
  if (res.headersSent) return res.end();
  return res.status(500).json({ error: 'Error interno del servidor' });
}

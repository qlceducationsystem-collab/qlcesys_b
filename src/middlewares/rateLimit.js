import rateLimit from 'express-rate-limit';

const make = (windowMin, max) =>
  rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { error: 'Demasiadas solicitudes, intenta más tarde' },
  });

export const authLimiter = make(15, 20);
export const apiLimiter = make(1, 300);

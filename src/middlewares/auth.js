import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { badRequest, forbidden, notFound, unauthorized } from '../utils/httpError.js';
import { getAccess } from '../services/access.service.js';

export const signToken = (user) => jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

const bearer = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

async function userFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw unauthorized('Sesión inválida o expirada');
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, role: true, adminLevel: true, isActive: true },
  });
  if (!user || !user.isActive) throw unauthorized('Usuario no disponible');
  return user;
}

export async function authenticate(req, _res, next) {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();
    req.user = await userFromToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

export async function optionalAuth(req, _res, next) {
  try {
    const token = bearer(req);
    if (token) req.user = await userFromToken(token).catch(() => undefined);
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));

const LEVELS = { VIEW: 1, EDIT: 2, FULL: 3 };
export const adminCan = (user, level) => user?.role === 'ADMIN' && (LEVELS[user.adminLevel] || 0) >= LEVELS[level];

export const requireAdminLevel = (level) => (req, _res, next) =>
  adminCan(req.user, level) ? next() : next(forbidden('Tu nivel de administrador no permite esta acción'));

const isWrite = (method) => !['GET', 'HEAD', 'OPTIONS'].includes(method);

export async function resolveSubject(req, _res, next) {
  try {
    const clientId = req.headers['x-client-id'];
    if (req.user.role === 'ADMIN') {
      if (!clientId) throw badRequest('Selecciona un cliente para gestionar');
      const client = await prisma.user.findFirst({ where: { id: String(clientId), role: 'CLIENT' }, select: { id: true } });
      if (!client) throw notFound('Cliente no encontrado');
      if (isWrite(req.method) && !adminCan(req.user, 'EDIT')) throw forbidden('Tu nivel de administrador es de solo visualización');
      req.subjectId = client.id;
      req.asAdmin = true;
    } else {
      req.subjectId = req.user.id;
      req.asAdmin = false;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireAccess(req, _res, next) {
  try {
    if (req.asAdmin) return next();
    req.access = await getAccess(req.subjectId);
    if (!req.access.hasAny) throw forbidden('Necesitas un acceso activo a QLC Financial Education');
    next();
  } catch (err) {
    next(err);
  }
}

export const subjectAccess = [authenticate, resolveSubject];
export const privateAccess = [authenticate, resolveSubject, requireAccess];

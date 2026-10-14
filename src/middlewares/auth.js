import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { badRequest, forbidden, notFound, unauthorized } from '../utils/httpError.js';
import { hasAccess } from '../domain/subscription.js';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

// Verifica el token y carga el usuario real desde base de datos (el rol nunca
// se toma del frontend).
export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();
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
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden());

const LEVELS = { VIEW: 1, EDIT: 2, FULL: 3 };
export const adminCan = (user, level) => user?.role === 'ADMIN' && (LEVELS[user.adminLevel] || 0) >= LEVELS[level];

// Exige un nivel administrativo mínimo (VIEW < EDIT < FULL).
export const requireAdminLevel = (level) => (req, _res, next) =>
  adminCan(req.user, level) ? next() : next(forbidden('Tu nivel de administrador no permite esta acción'));

const isWrite = (method) => !['GET', 'HEAD', 'OPTIONS'].includes(method);

/**
 * Define sobre qué usuario se opera (req.subjectId).
 * - Cliente: siempre él mismo; el header se ignora.
 * - Admin: debe indicar X-Client-Id y opera sobre los MISMOS registros del cliente.
 *   Con nivel VIEW solo puede consultar.
 */
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

// Bloquea funciones privadas si la membresía no está activa (los datos se conservan).
export async function requireMembership(req, _res, next) {
  try {
    if (req.user.role === 'ADMIN') return next();
    const sub = await prisma.subscription.findUnique({ where: { userId: req.subjectId } });
    if (!hasAccess(sub)) throw forbidden('Tu membresía no está activa');
    req.subscription = sub;
    next();
  } catch (err) {
    next(err);
  }
}

// Cadena estándar para rutas privadas del cliente.
export const privateAccess = [authenticate, resolveSubject, requireMembership];

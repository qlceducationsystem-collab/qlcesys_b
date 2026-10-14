import jwt from 'jsonwebtoken';
import { prisma } from '../../config/prisma.js';
import { env, googleConfigured } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../utils/crypto.js';
import { badRequest, HttpError } from '../../utils/httpError.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export const SERVICE_SCOPES = {
  DRIVE: ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'],
  GMAIL: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'],
};

const tokenCache = new Map();

function assertConfigured() {
  if (!googleConfigured()) throw new HttpError(503, 'Configuración de Google pendiente en el servidor');
}

export function buildAuthUrl(service, adminId) {
  assertConfigured();
  const state = jwt.sign({ svc: service, adm: adminId }, env.jwtSecret, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: env.google.redirectUri,
    response_type: 'code',
    scope: SERVICE_SCOPES[service].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.google.clientId, client_secret: env.google.clientSecret, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Google rechazó la solicitud (${data.error || res.status})`);
  return data;
}

export async function handleCallback({ code, state }) {
  assertConfigured();
  let payload;
  try {
    payload = jwt.verify(String(state), env.jwtSecret);
  } catch {
    throw badRequest('La solicitud de conexión expiró. Intenta de nuevo.');
  }
  const service = payload.svc;
  if (!SERVICE_SCOPES[service]) throw badRequest('Servicio no válido');
  const tokens = await tokenRequest({ code: String(code), grant_type: 'authorization_code', redirect_uri: env.google.redirectUri });
  if (!tokens.refresh_token) throw badRequest('Google no entregó un token de actualización. Revoca el acceso previo y vuelve a conectar.');
  const info = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } }).then((r) => r.json()).catch(() => ({}));
  tokenCache.set(service, { token: tokens.access_token, exp: Date.now() + (tokens.expires_in - 60) * 1000 });
  const data = {
    email: info.email || null,
    encryptedRefreshToken: encryptSecret(tokens.refresh_token),
    scopes: tokens.scope || SERVICE_SCOPES[service].join(' '),
    status: 'CONNECTED',
    connectedAt: new Date(),
    connectedById: payload.adm,
    lastError: null,
  };
  await prisma.googleIntegration.upsert({ where: { service }, create: { service, ...data }, update: data });
  return service;
}

export async function getAccessToken(service) {
  const cached = tokenCache.get(service);
  if (cached && cached.exp > Date.now()) return cached.token;
  assertConfigured();
  const integration = await prisma.googleIntegration.findUnique({ where: { service } });
  if (!integration?.encryptedRefreshToken || integration.status !== 'CONNECTED') {
    throw new HttpError(503, `${service === 'DRIVE' ? 'Google Drive' : 'Gmail'} no está conectado`);
  }
  try {
    const tokens = await tokenRequest({ refresh_token: decryptSecret(integration.encryptedRefreshToken), grant_type: 'refresh_token' });
    tokenCache.set(service, { token: tokens.access_token, exp: Date.now() + (tokens.expires_in - 60) * 1000 });
    await prisma.googleIntegration.update({ where: { service }, data: { lastSyncAt: new Date(), lastError: null } });
    return tokens.access_token;
  } catch (err) {
    await prisma.googleIntegration.update({ where: { service }, data: { status: 'ERROR', lastError: err.message.slice(0, 300) } });
    throw err;
  }
}

export async function disconnect(service) {
  const integration = await prisma.googleIntegration.findUnique({ where: { service } });
  tokenCache.delete(service);
  if (integration?.encryptedRefreshToken && googleConfigured()) {
    const token = decryptSecret(integration.encryptedRefreshToken);
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => null);
  }
  await prisma.googleIntegration.upsert({
    where: { service },
    create: { service, status: 'DISCONNECTED' },
    update: { status: 'DISCONNECTED', encryptedRefreshToken: null, email: null, connectedAt: null, lastError: null },
  });
}

export async function integrationStatus() {
  const rows = await prisma.googleIntegration.findMany();
  return ['DRIVE', 'GMAIL'].map((service) => {
    const row = rows.find((r) => r.service === service);
    return {
      service,
      configured: googleConfigured(),
      status: row?.status || 'DISCONNECTED',
      email: row?.email || null,
      connectedAt: row?.connectedAt || null,
      lastSyncAt: row?.lastSyncAt || null,
      lastError: row?.lastError || null,
    };
  });
}

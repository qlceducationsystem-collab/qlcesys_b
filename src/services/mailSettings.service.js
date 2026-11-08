import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
import { badRequest } from '../utils/httpError.js';
import { hasGrantedScopes } from './google/oauth.js';

const OAUTH_KEY = 'google-oauth';
const NOTIFY_KEY = 'notifications';
const TRANSPORT_KEY = 'mail-transport';
const serverGoogle = { clientId: env.google.clientId, clientSecret: env.google.clientSecret };
let notifyCache = null;
let transportCache = null;

export const CLIENT_EMAIL_LABELS = {
  BIENVENIDA: 'Bienvenida al crear su cuenta',
  ACCESO_ACTIVADO: 'Acceso activado o renovado',
  SERVICIO_DISPONIBLE: 'Consultas o sesiones adquiridas',
  ACCESO_VENCIDO: 'Su suscripción venció',
  RENOVACION_PENDIENTE: 'Aviso para pagar su renovación (transferencia Bitget)',
  PAGO_BITGET_RECHAZADO: 'Su reporte de transferencia Bitget necesita corrección',
  CONSULTA_RESPONDIDA: 'Respuesta a su consulta pagada',
  EJERCICIO_RESPONDIDO: 'Respuesta a su ejercicio o duda',
  CITA_ACTUALIZADA: 'Su cita fue confirmada, reprogramada o cancelada',
  CODIGOS_REGALO: 'Códigos de regalo comprados',
  REGALO_ACTIVADO: 'La persona activó su regalo',
  PROMOCION: 'Promociones personalizadas',
};

export const CLIENT_EMAIL_GROUPS = [
  ['Cuenta y suscripción', ['BIENVENIDA', 'ACCESO_ACTIVADO', 'SERVICIO_DISPONIBLE', 'ACCESO_VENCIDO', 'RENOVACION_PENDIENTE', 'PAGO_BITGET_RECHAZADO']],
  ['Academia y asesoría', ['CONSULTA_RESPONDIDA', 'EJERCICIO_RESPONDIDO', 'CITA_ACTUALIZADA']],
  ['Regalos y promociones', ['CODIGOS_REGALO', 'REGALO_ACTIVADO', 'PROMOCION']],
].map(([label, types]) => ({ label, events: types.map((type) => ({ type, label: CLIENT_EMAIL_LABELS[type] })) }));

const mask = (v) => (v ? `${v.slice(0, 6)}••••••••${v.slice(-4)}` : null);
const maskEmail = (v) => {
  if (!v) return null;
  const [name, domain] = v.split('@');
  return `${name.slice(0, 3)}••••••••@${domain}`;
};

export async function mailTransport() {
  if (transportCache) return transportCache;
  const row = await prisma.appSetting.findUnique({ where: { key: TRANSPORT_KEY } }).catch(() => null);
  transportCache = { method: 'OAUTH', email: null, encryptedPassword: null, lastTest: null, ...(row?.value || {}) };
  return transportCache;
}

async function saveTransport(changes) {
  const value = { ...(await mailTransport()), ...changes };
  await prisma.appSetting.upsert({ where: { key: TRANSPORT_KEY }, create: { key: TRANSPORT_KEY, value }, update: { value } });
  transportCache = null;
}

export const smtpPassword = (transport) => decryptSecret(transport.encryptedPassword);

export const recordMailTest = (result) => saveTransport({ lastTest: { at: new Date().toISOString(), ok: !!result.sent, error: result.sent ? null : String(result.error || '').slice(0, 300) } });

export async function applyGoogleCredentials() {
  const row = await prisma.appSetting.findUnique({ where: { key: OAUTH_KEY } }).catch(() => null);
  const value = row?.value || {};
  let secret = null;
  try {
    secret = value.encryptedSecret ? decryptSecret(value.encryptedSecret) : null;
  } catch {
    secret = null;
  }
  env.google.clientId = value.clientId || serverGoogle.clientId;
  env.google.clientSecret = secret || serverGoogle.clientSecret;
  return { source: value.clientId ? 'PANEL' : serverGoogle.clientId ? 'SERVER' : null };
}

export async function notificationSettings() {
  if (notifyCache) return notifyCache;
  const row = await prisma.appSetting.findUnique({ where: { key: NOTIFY_KEY } }).catch(() => null);
  notifyCache = { senderName: 'QLC Financial Education', disabled: [], clientDisabled: [], ...(row?.value || {}) };
  return notifyCache;
}

export async function notificationAccount() {
  const transport = await mailTransport();
  if (transport.method === 'SMTP') return transport.email;
  return (await prisma.googleIntegration.findUnique({ where: { service: 'GMAIL' } }))?.email || null;
}

export async function mailSettingsView() {
  const [row, notify, gmail, transport] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: OAUTH_KEY } }),
    notificationSettings(),
    prisma.googleIntegration.findUnique({ where: { service: 'GMAIL' } }),
    mailTransport(),
  ]);
  const value = row?.value || {};
  const oauthConnected = gmail?.status === 'CONNECTED' && hasGrantedScopes('GMAIL', gmail.scopes);
  const smtpReady = !!(transport.email && transport.encryptedPassword && transport.lastTest?.ok);
  return {
    method: transport.method,
    connected: transport.method === 'SMTP' ? smtpReady : oauthConnected,
    account: maskEmail(transport.method === 'SMTP' ? transport.email : gmail?.email),
    smtpEmail: transport.email,
    hasSmtpPassword: !!transport.encryptedPassword,
    lastTest: transport.lastTest,
    clientId: mask(value.clientId || serverGoogle.clientId),
    hasSecret: !!(value.encryptedSecret || serverGoogle.clientSecret),
    source: value.clientId ? 'PANEL' : serverGoogle.clientId ? 'SERVER' : null,
    encryptionReady: !!env.tokenEncryptionKey,
    redirectUri: env.google.redirectUri,
    gmail: { status: gmail?.status || 'DISCONNECTED', missingScope: gmail?.status === 'CONNECTED' && !oauthConnected, email: gmail?.email || null, connectedAt: gmail?.connectedAt || null, lastError: gmail?.lastError || null },
    senderName: notify.senderName,
    disabled: notify.disabled,
    clientDisabled: notify.clientDisabled,
  };
}

export async function saveMailSettings({ clientId, clientSecret, senderName, disabled, clientDisabled, method, smtpEmail, smtpPassword: newSmtpPassword }) {
  if (method !== undefined || smtpEmail !== undefined || newSmtpPassword) {
    if (newSmtpPassword && !env.tokenEncryptionKey) throw badRequest('Falta TOKEN_ENCRYPTION_KEY en el servidor para guardar la contraseña cifrada');
    const current = await mailTransport();
    const emailChanged = smtpEmail !== undefined && (smtpEmail || null) !== current.email;
    const methodChanged = method !== undefined && method !== current.method;
    await saveTransport({
      ...(emailChanged || methodChanged || newSmtpPassword ? { lastTest: null } : {}),
      ...(method !== undefined ? { method } : {}),
      ...(smtpEmail !== undefined ? { email: smtpEmail || null } : {}),
      ...(newSmtpPassword ? { encryptedPassword: encryptSecret(newSmtpPassword.replace(/\s+/g, '')) } : emailChanged ? { encryptedPassword: null } : {}),
    });
  }
  if (clientId !== undefined || clientSecret) {
    if (!env.tokenEncryptionKey) throw badRequest('Falta TOKEN_ENCRYPTION_KEY en el servidor para guardar las credenciales cifradas');
    const current = (await prisma.appSetting.findUnique({ where: { key: OAUTH_KEY } }))?.value || {};
    const value = {
      clientId: clientId === undefined ? current.clientId : clientId || null,
      encryptedSecret: clientSecret ? encryptSecret(clientSecret) : current.encryptedSecret || null,
    };
    await prisma.appSetting.upsert({ where: { key: OAUTH_KEY }, create: { key: OAUTH_KEY, value }, update: { value } });
    await applyGoogleCredentials();
  }
  const notify = await notificationSettings();
  const value = {
    senderName: senderName ?? notify.senderName,
    disabled: disabled ?? notify.disabled,
    clientDisabled: clientDisabled ?? notify.clientDisabled,
  };
  await prisma.appSetting.upsert({ where: { key: NOTIFY_KEY }, create: { key: NOTIFY_KEY, value }, update: { value } });
  notifyCache = null;
  return mailSettingsView();
}

import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
import { badRequest } from '../utils/httpError.js';

const OAUTH_KEY = 'google-oauth';
const NOTIFY_KEY = 'notifications';
const serverGoogle = { clientId: env.google.clientId, clientSecret: env.google.clientSecret };
let notifyCache = null;

export const CLIENT_EMAIL_LABELS = {
  BIENVENIDA: 'Bienvenida al crear su cuenta',
  ACCESO_ACTIVADO: 'Acceso activado o renovado',
  SERVICIO_DISPONIBLE: 'Consultas o sesiones adquiridas',
  ACCESO_VENCIDO: 'Su suscripción venció',
  CONSULTA_RESPONDIDA: 'Respuesta a su consulta pagada',
  EJERCICIO_RESPONDIDO: 'Respuesta a su ejercicio o duda',
  CITA_ACTUALIZADA: 'Su cita fue confirmada, reprogramada o cancelada',
  CODIGOS_REGALO: 'Códigos de regalo comprados',
  REGALO_ACTIVADO: 'La persona activó su regalo',
  PROMOCION: 'Promociones personalizadas',
};

export const CLIENT_EMAIL_GROUPS = [
  ['Cuenta y suscripción', ['BIENVENIDA', 'ACCESO_ACTIVADO', 'SERVICIO_DISPONIBLE', 'ACCESO_VENCIDO']],
  ['Academia y asesoría', ['CONSULTA_RESPONDIDA', 'EJERCICIO_RESPONDIDO', 'CITA_ACTUALIZADA']],
  ['Regalos y promociones', ['CODIGOS_REGALO', 'REGALO_ACTIVADO', 'PROMOCION']],
].map(([label, types]) => ({ label, events: types.map((type) => ({ type, label: CLIENT_EMAIL_LABELS[type] })) }));

const mask = (v) => (v ? `${v.slice(0, 6)}••••••••${v.slice(-4)}` : null);

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
  notifyCache = { recipients: [], senderName: 'QLC Financial Education', disabled: [], clientDisabled: [], ...(row?.value || {}) };
  return notifyCache;
}

export async function mailSettingsView() {
  const [row, notify, gmail] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: OAUTH_KEY } }),
    notificationSettings(),
    prisma.googleIntegration.findUnique({ where: { service: 'GMAIL' } }),
  ]);
  const value = row?.value || {};
  return {
    clientId: mask(value.clientId || serverGoogle.clientId),
    hasSecret: !!(value.encryptedSecret || serverGoogle.clientSecret),
    source: value.clientId ? 'PANEL' : serverGoogle.clientId ? 'SERVER' : null,
    encryptionReady: !!env.tokenEncryptionKey,
    redirectUri: env.google.redirectUri,
    gmail: { status: gmail?.status || 'DISCONNECTED', email: gmail?.email || null, connectedAt: gmail?.connectedAt || null, lastError: gmail?.lastError || null },
    senderName: notify.senderName,
    recipients: notify.recipients,
    disabled: notify.disabled,
    clientDisabled: notify.clientDisabled,
  };
}

export async function saveMailSettings({ clientId, clientSecret, senderName, recipients, disabled, clientDisabled }) {
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
    recipients: recipients ?? notify.recipients,
    disabled: disabled ?? notify.disabled,
    clientDisabled: clientDisabled ?? notify.clientDisabled,
  };
  await prisma.appSetting.upsert({ where: { key: NOTIFY_KEY }, create: { key: NOTIFY_KEY, value }, update: { value } });
  notifyCache = null;
  return mailSettingsView();
}

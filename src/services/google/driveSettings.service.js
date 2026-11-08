import { prisma } from '../../config/prisma.js';
import { HttpError, badRequest } from '../../utils/httpError.js';
import { mailSettingsView } from '../mailSettings.service.js';
import { deleteFile, driveConnected, ensureRootFolder, uploadBuffer } from './drive.js';
import { hasGrantedScopes } from './oauth.js';

const KEY = 'drive-status';
const folderUrl = (id) => (id ? `https://drive.google.com/drive/folders/${id}` : null);

export function driveErrorMessage(err) {
  const text = String(err?.message || '');
  if (/accessNotConfigured|has not been used|SERVICE_DISABLED|is disabled/i.test(text)) return 'La Google Drive API no está activada. Actívala en Google Cloud Console, en el mismo proyecto de la aplicación de Gmail, espera unos minutos y vuelve a probar.';
  if (/insufficient|ACCESS_TOKEN_SCOPE/i.test(text)) return 'La cuenta no dio permiso para usar Google Drive. Pulsa Reconectar con Google y acepta el permiso.';
  if (/invalid_grant|invalid_client|unauthorized_client|Google rechazó/i.test(text)) return 'Google rechazó la conexión. Pulsa Reconectar con Google; si cambió el Client ID o el Client Secret, también hay que reconectar.';
  if (/storageQuotaExceeded/i.test(text)) return 'El Google Drive de esta cuenta no tiene espacio disponible.';
  return `No pudimos completar la prueba con Google Drive: ${text.slice(0, 160)}`;
}

export async function driveSettingsView() {
  const [row, setting, mail] = await Promise.all([
    prisma.googleIntegration.findUnique({ where: { service: 'DRIVE' } }),
    prisma.appSetting.findUnique({ where: { key: KEY } }),
    mailSettingsView(),
  ]);
  const linked = row?.status === 'CONNECTED' && !!row.encryptedRefreshToken;
  return {
    status: row?.status || 'DISCONNECTED',
    connected: linked && hasGrantedScopes('DRIVE', row.scopes),
    missingScope: linked && !hasGrantedScopes('DRIVE', row.scopes),
    email: row?.email || null,
    gmailEmail: mail.gmail.email,
    connectedAt: row?.connectedAt || null,
    lastError: row?.lastError || null,
    folderUrl: linked ? folderUrl(row?.driveFolders?.root) : null,
    lastTest: setting?.value || null,
    clientId: mail.clientId,
    hasSecret: mail.hasSecret,
    redirectUri: mail.redirectUri,
    encryptionReady: mail.encryptionReady,
  };
}

export async function testDriveConnection(now = new Date()) {
  if (!(await driveConnected())) throw badRequest('Primero conecta una cuenta de Google con el permiso de Google Drive.');
  let result;
  try {
    const parentId = await ensureRootFolder();
    const file = await uploadBuffer({ buffer: Buffer.from('Prueba de conexión de QLC'), name: 'Prueba de conexion QLC.txt', mimeType: 'text/plain', parentId });
    await deleteFile(file.id);
    result = { at: now.toISOString(), ok: true, error: null };
  } catch (err) {
    if (err instanceof HttpError && err.status === 503) throw err;
    console.error('[drive] prueba de conexión:', err.message);
    result = { at: now.toISOString(), ok: false, error: driveErrorMessage(err) };
  }
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: result }, update: { value: result } });
  return driveSettingsView();
}

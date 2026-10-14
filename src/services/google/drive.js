import fs from 'node:fs';
import { Readable } from 'node:stream';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../utils/httpError.js';
import { getAccessToken } from './oauth.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_NAME = 'QLC Financial Education';
const KIND_FOLDER = { VIDEO: 'Videos', DOCUMENT: 'Documentos', REPORT: 'Informes anuales' };

async function driveFetch(url, init = {}) {
  const token = await getAccessToken('DRIVE');
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (!res.ok && res.status !== 206) {
    const detail = await res.text().catch(() => '');
    throw new HttpError(res.status === 404 ? 404 : 502, `Google Drive respondió ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
  }
  return res;
}

async function createFolder(name, parentId) {
  const res = await driveFetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return (await res.json()).id;
}

async function folderExists(id) {
  try {
    const res = await driveFetch(`${API}/files/${id}?fields=id,trashed`);
    return !(await res.json()).trashed;
  } catch {
    return false;
  }
}

export async function ensureFolder(kind, moduleNumber) {
  const integration = await prisma.googleIntegration.findUnique({ where: { service: 'DRIVE' } });
  const folders = { ...(integration?.driveFolders || {}) };
  const ensure = async (key, name, parentKey) => {
    if (folders[key] && (await folderExists(folders[key]))) return folders[key];
    folders[key] = await createFolder(name, parentKey ? folders[parentKey] : undefined);
    return folders[key];
  };
  await ensure('root', ROOT_NAME);
  await ensure(kind, KIND_FOLDER[kind], 'root');
  const id = await ensure(`${kind}:${moduleNumber}`, `Modulo-${moduleNumber}`, kind);
  await prisma.googleIntegration.update({ where: { service: 'DRIVE' }, data: { driveFolders: folders, lastSyncAt: new Date() } });
  return id;
}

async function resumableUpload({ name, mimeType, size, kind, moduleNumber, body }) {
  const parent = await ensureFolder(kind, moduleNumber);
  const session = await driveFetch(`${UPLOAD}?uploadType=resumable&fields=id,name,mimeType,size`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify({ name, parents: [parent] }),
  });
  const location = session.headers.get('location');
  const res = await driveFetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType, 'Content-Length': String(size) },
    body,
    duplex: 'half',
  });
  return res.json();
}

export const uploadFile = ({ filePath, size, ...meta }) =>
  resumableUpload({ ...meta, size, body: Readable.toWeb(fs.createReadStream(filePath)) });

export const uploadBuffer = ({ buffer, ...meta }) => resumableUpload({ ...meta, size: buffer.length, body: buffer });

export async function driveConnected() {
  const row = await prisma.googleIntegration.findUnique({ where: { service: 'DRIVE' } });
  return row?.status === 'CONNECTED' && !!row.encryptedRefreshToken;
}

export async function streamFile(fileId, range, res) {
  const upstream = await driveFetch(`${API}/files/${fileId}?alt=media`, { headers: range ? { Range: range } : {} });
  res.status(upstream.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  Readable.fromWeb(upstream.body).pipe(res);
}

export async function deleteFile(fileId) {
  try {
    await driveFetch(`${API}/files/${fileId}`, { method: 'DELETE' });
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

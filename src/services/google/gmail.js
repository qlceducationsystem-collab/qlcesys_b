import crypto from 'node:crypto';
import { HttpError } from '../../utils/httpError.js';
import { getAccessToken } from './oauth.js';

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

const encodeHeader = (value) => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const encodeBody = (value) => (Buffer.from(value || '', 'utf8').toString('base64').match(/.{1,76}/g) || ['']).join('\r\n');

export function buildMime({ to, subject, html, text, from }) {
  const boundary = `qlc_${crypto.randomBytes(12).toString('hex')}`;
  const domain = /@([^>\s]+)/.exec(from || '')?.[1] || 'gmail.com';
  return [
    ...(from ? [`From: ${from}`] : []),
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBody(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeBody(html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export async function sendGmail(message) {
  const token = await getAccessToken('GMAIL');
  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(buildMime(message), 'utf8').toString('base64url') }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (/insufficient authentication scopes/i.test(data.error?.message || '')) {
      throw new HttpError(502, 'Google no dio permiso para enviar correos. Pulsa Reconectar con Google y marca la casilla de enviar correo electrónico en tu nombre.');
    }
    throw new HttpError(502, `Gmail rechazó el envío (${data.error?.message || res.status})`);
  }
  return res.json();
}

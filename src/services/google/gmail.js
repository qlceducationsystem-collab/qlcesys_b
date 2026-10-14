import { HttpError } from '../../utils/httpError.js';
import { getAccessToken } from './oauth.js';

const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

const encodeHeader = (value) => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

export function buildMime({ to, subject, html, text }) {
  const boundary = `qlc_${Date.now().toString(36)}`;
  return [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text || '', 'utf8').toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
    `--${boundary}--`,
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
    throw new HttpError(502, `Gmail rechazó el envío (${data.error?.message || res.status})`);
  }
  return res.json();
}

import { prisma } from '../config/prisma.js';
import { env, googleConfigured } from '../config/env.js';
import { sendGmail } from './google/gmail.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const layout = (title, body) => `<!doctype html><html><body style="margin:0;background:#05070a;font-family:Segoe UI,Arial,sans-serif;color:#f4f7fb">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0d131a;border:1px solid #1f2a36;border-radius:16px">
<tr><td style="padding:28px 32px 8px;color:#5bd4ff;font-size:11px;letter-spacing:3px;font-weight:700">QLC FINANCIAL EDUCATION</td></tr>
<tr><td style="padding:0 32px;font-size:22px;font-weight:700">${escapeHtml(title)}</td></tr>
<tr><td style="padding:16px 32px 28px;color:#c7ccd2;font-size:14px;line-height:1.6">${body}</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #1f2a36;color:#6f7c89;font-size:11px">Herramienta educativa y de organización financiera. No constituye asesoría financiera.</td></tr>
</table></td></tr></table></body></html>`;

const button = (href, label) =>
  `<p style="margin:22px 0"><a href="${href}" style="background:#0094dc;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:600">${escapeHtml(label)}</a></p>`;

const READY_CACHE_MS = 60 * 1000;
let ready = null;
let testReady = false;

export const testEmail = {
  outbox: [],
  setReady: (value) => {
    testReady = value;
  },
};

export async function emailReady() {
  if (env.isTest) return testReady;
  if (ready && ready.exp > Date.now()) return ready.value;
  const value = googleConfigured() && (await prisma.googleIntegration.findUnique({ where: { service: 'GMAIL' } }))?.status === 'CONNECTED';
  ready = { value, exp: Date.now() + READY_CACHE_MS };
  return value;
}

export const TEMPLATES = {
  verifyEmail: ({ code, minutes }) => ({
    subject: `${code} es tu código de verificación · QLC`,
    title: 'Confirma tu correo electrónico',
    body: `<p>Usa este código para terminar de crear tu cuenta:</p><p style="margin:22px 0;font-size:32px;letter-spacing:10px;font-weight:700;color:#5bd4ff">${escapeHtml(code)}</p><p>El código vence en ${minutes} minutos. Si no solicitaste una cuenta, ignora este mensaje.</p>`,
    text: `Tu código de verificación de QLC es ${code}. Vence en ${minutes} minutos.`,
  }),
  welcome: ({ name }) => ({
    subject: 'Bienvenido a QLC Financial Education',
    title: `Hola, ${name}`,
    body: `<p>Tu cuenta fue creada correctamente. Desde tu plataforma podrás registrar tu situación financiera y avanzar en tu programa educativo.</p>${button(`${env.frontendUrl}/app`, 'Entrar a mi plataforma')}`,
    text: `Hola ${name}, tu cuenta en QLC Financial Education fue creada. Entra en ${env.frontendUrl}/app`,
  }),
  test: ({ name }) => ({
    subject: 'Correo de prueba · QLC Financial Education',
    title: 'Integración de Gmail funcionando',
    body: `<p>Este correo confirma que la cuenta conectada puede enviar notificaciones del sistema.</p><p>Solicitado por ${escapeHtml(name)}.</p>`,
    text: 'Integración de Gmail funcionando.',
  }),
};

export async function sendEmail(template, to, data = {}) {
  const content = TEMPLATES[template](data);
  if (env.isTest && testReady) {
    testEmail.outbox.push({ template, to, data });
    return { sent: true };
  }
  try {
    await sendGmail({ to, subject: content.subject, html: layout(content.title, content.body), text: content.text });
    await prisma.emailLog.create({ data: { to, subject: content.subject, template, status: 'SENT' } });
    return { sent: true };
  } catch (err) {
    await prisma.emailLog.create({ data: { to, subject: content.subject, template, status: 'FAILED', error: err.message.slice(0, 300) } }).catch(() => null);
    if (!env.isProd) console.info(`[email] ${template} → ${to} no enviado: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

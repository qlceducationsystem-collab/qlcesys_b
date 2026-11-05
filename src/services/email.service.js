import { prisma } from '../config/prisma.js';
import { env, googleConfigured } from '../config/env.js';
import { sendGmail } from './google/gmail.js';
import { hasGrantedScopes } from './google/oauth.js';
import nodemailer from 'nodemailer';
import { mailTransport, notificationSettings, smtpPassword } from './mailSettings.service.js';
import { layout, normalizeLang, renderEmail } from './emailTemplates.js';

const READY_CACHE_MS = 60 * 1000;
let ready = null;
let testReady = false;

export const testEmail = {
  outbox: [],
  setReady: (value) => {
    testReady = value;
  },
};

export const gmailCanSend = (row) => row?.status === 'CONNECTED' && hasGrantedScopes('GMAIL', row.scopes);

export const resetEmailReady = () => {
  ready = null;
};

export async function emailReady() {
  if (env.isTest) return testReady;
  if (ready && ready.exp > Date.now()) return ready.value;
  const transport = await mailTransport();
  const value = transport.method === 'SMTP'
    ? !!(transport.email && transport.encryptedPassword && env.tokenEncryptionKey && transport.lastTest?.ok)
    : googleConfigured() && gmailCanSend(await prisma.googleIntegration.findUnique({ where: { service: 'GMAIL' } }));
  ready = { value, exp: Date.now() + READY_CACHE_MS };
  return value;
}

export async function sendClientEmail(type, template, to, data = {}) {
  const settings = await notificationSettings();
  if (settings.clientDisabled?.includes(type)) return { sent: false, skipped: true };
  return sendEmail(template, to, data);
}

async function recipientLanguage(to) {
  const user = await prisma.user.findUnique({ where: { email: String(to).toLowerCase() }, select: { language: true } }).catch(() => null);
  return normalizeLang(user?.language);
}

export async function sendEmail(template, to, data = {}, { lang } = {}) {
  const language = lang ? normalizeLang(lang) : await recipientLanguage(to);
  const content = renderEmail(template, data, language);
  const logSubject = content.subject.replace(/^\d{6}/, '••••••');
  if (env.isTest && testReady) {
    testEmail.outbox.push({ template, to, data, lang: language, subject: content.subject });
    return { sent: true };
  }
  try {
    const [settings, transport] = await Promise.all([notificationSettings(), mailTransport()]);
    const html = layout(content.title, content.body, language);
    if (transport.method === 'SMTP') {
      if (!transport.email || !transport.encryptedPassword) throw new Error('Falta la cuenta de Gmail o la contraseña de aplicación');
      const smtp = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: transport.email, pass: smtpPassword(transport) }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
      await smtp.sendMail({ from: { name: settings.senderName || 'QLC', address: transport.email }, to, subject: content.subject, html, text: content.text });
    } else {
      const gmail = await prisma.googleIntegration.findUnique({ where: { service: 'GMAIL' } });
      const from = gmail?.email && settings.senderName ? `${'=?UTF-8?B?' + Buffer.from(settings.senderName, 'utf8').toString('base64') + '?='} <${gmail.email}>` : null;
      await sendGmail({ to, subject: content.subject, html, text: content.text, from });
    }
    await prisma.emailLog.create({ data: { to, subject: logSubject, template, status: 'SENT' } });
    return { sent: true };
  } catch (err) {
    await prisma.emailLog.create({ data: { to, subject: logSubject, template, status: 'FAILED', error: err.message.slice(0, 300) } }).catch(() => null);
    if (!env.isProd) console.info(`[email] ${template} → ${to} no enviado: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

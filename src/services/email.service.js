import { prisma } from '../config/prisma.js';
import { env, googleConfigured } from '../config/env.js';
import { sendGmail } from './google/gmail.js';
import { hasGrantedScopes } from './google/oauth.js';
import nodemailer from 'nodemailer';
import { mailTransport, notificationSettings, smtpPassword } from './mailSettings.service.js';

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

const money = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n)));
const when = (d) => new Date(d).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });
const row = (label, value) => `<tr><td style="padding:6px 0;color:#6f7c89;width:38%">${escapeHtml(label)}</td><td style="padding:6px 0;color:#f4f7fb">${escapeHtml(value ?? '—')}</td></tr>`;

export const TEMPLATES = {
  adminEvent: (e) => ({
    subject: `${e.label} · ${e.userName || e.userEmail || 'QLC'}`,
    title: e.label,
    body: `<table width="100%" cellpadding="0" cellspacing="0">${[
      row('Nombre', e.userName),
      row('Correo', e.userEmail),
      row('Producto', e.product),
      row('Suscripción', e.period ? (e.period === 'ANUAL' ? 'Anual' : e.period === 'MENSUAL' ? 'Mensual' : e.period) : '—'),
      row('Estado', e.status),
      row('Fecha', when(e.createdAt)),
      row('Importe', e.amount === null ? '—' : money(e.amount)),
      ...(e.result ? [row('Resultado', e.result)] : []),
    ].join('')}</table>${button(`${env.frontendUrl}/admin/suscriptores`, 'Abrir panel de suscriptores')}`,
    text: `${e.label}. ${e.userName || ''} ${e.userEmail || ''}. Producto: ${e.product || '—'}. Estado: ${e.status || '—'}. Importe: ${e.amount === null ? '—' : money(e.amount)}.`,
  }),
  promotion: ({ name, discount, product, code, validUntil, message }) => ({
    subject: `Regresa a QLC con ${discount}% de descuento`,
    title: `Regresa a QLC con ${discount}% de descuento`,
    body: `<p>Hola ${escapeHtml(name)},</p><p>${escapeHtml(message || `Queremos invitarte a regresar a QLC. Reactiva tu acceso con un beneficio especial del ${discount}% de descuento en tu renovación.`)}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border:1px solid #1f2a36;border-radius:12px"><tr><td style="padding:16px 18px">
<div style="color:#6f7c89;font-size:11px;letter-spacing:2px">DESCUENTO</div><div style="font-size:30px;font-weight:700;color:#5bd4ff">${discount}%</div>
<div style="margin-top:8px">Producto: <b>${escapeHtml(product)}</b></div>
<div>Código: <b style="letter-spacing:2px">${escapeHtml(code)}</b></div>
<div>Válido hasta: ${escapeHtml(when(validUntil))}</div></td></tr></table>
${button(`${env.frontendUrl}/app/acceso?promo=${encodeURIComponent(code)}`, 'Usar mi promoción')}
<p style="font-size:12px;color:#6f7c89">Promoción personalizada y sujeta a vigencia. Al pagar, tu acceso se activa una vez que el equipo de QLC lo autorice. Si no deseas recibir promociones, desactívalas en Mi acceso.</p>`,
    text: `Hola ${name}, regresa a QLC con ${discount}% de descuento en ${product}. Código: ${code}. Válido hasta ${when(validUntil)}.`,
  }),
  giftCodes: ({ name, product, codes, redeemBy }) => ({
    subject: 'Tus códigos de regalo de QLC',
    title: 'Tu regalo está listo',
    body: `<p>Hola ${escapeHtml(name)}, gracias por regalar conocimiento financiero.</p><p>Producto: <b>${escapeHtml(product)}</b></p>
${codes.map((c) => `<p style="margin:10px 0;font-size:22px;letter-spacing:3px;font-weight:700;color:#5bd4ff">${escapeHtml(c)}</p>`).join('')}
<p>Comparte el código con la persona que quieres obsequiar. Puede canjearlo hasta el ${escapeHtml(when(redeemBy))} en:</p>${button(`${env.frontendUrl}/regalo`, 'Canjear código de regalo')}`,
    text: `Tus códigos de regalo QLC (${product}): ${codes.join(', ')}. Canjéalos en ${env.frontendUrl}/regalo`,
  }),
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
  retention: ({ name, left, deleteOn, product }) => ({
    subject: left === 1 ? 'Último aviso: mañana se elimina tu cuenta QLC' : `Tu cuenta QLC se elimina en ${left} días`,
    title: left === 1 ? 'Queda 1 día para renovar' : `Quedan ${left} días para renovar`,
    body: `<p>Hola ${escapeHtml(name)},</p><p>Tu suscripción${product ? ` a <b>${escapeHtml(product)}</b>` : ''} terminó. Si no la renuevas, el ${escapeHtml(when(deleteOn))} el sistema eliminará tu cuenta y toda la información que registraste en la plataforma.</p><p>Renueva ahora para conservar tu avance, tus registros y tu historial.</p>${button(`${env.frontendUrl}/app/acceso`, 'Renovar mi acceso')}`,
    text: `Hola ${name}, tu suscripción QLC terminó. Quedan ${left} día(s): si no renuevas, el ${when(deleteOn)} se eliminará tu cuenta y tu información. Renueva en ${env.frontendUrl}/app/acceso`,
  }),
  accessActivated: ({ name, product, expiresAt }) => ({
    subject: `Tu acceso a ${product} está activo`,
    title: 'Tu acceso está activo',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Ya puedes usar <b>${escapeHtml(product)}</b>${expiresAt ? ` hasta el ${escapeHtml(when(expiresAt))}` : ''}.</p>${button(`${env.frontendUrl}/app`, 'Entrar a mi plataforma')}`,
    text: `Hola ${name}, tu acceso a ${product} está activo${expiresAt ? ` hasta el ${when(expiresAt)}` : ''}.`,
  }),
  serviceCredits: ({ name, product, quantity }) => ({
    subject: `Tu compra de ${product} está disponible`,
    title: 'Compra disponible',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Ya tienes disponible: <b>${escapeHtml(String(quantity))} × ${escapeHtml(product)}</b>.</p>${button(`${env.frontendUrl}/app`, 'Entrar a mi plataforma')}`,
    text: `Hola ${name}, ya tienes disponible ${quantity} x ${product}.`,
  }),
  accessExpired: ({ name, product }) => ({
    subject: 'Tu suscripción de QLC venció',
    title: 'Tu suscripción venció',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Tu acceso${product ? ` a <b>${escapeHtml(product)}</b>` : ''} terminó. Renueva para seguir usando la plataforma y conservar tu información.</p>${button(`${env.frontendUrl}/app/acceso`, 'Renovar mi acceso')}`,
    text: `Hola ${name}, tu acceso${product ? ` a ${product}` : ''} terminó. Renueva en ${env.frontendUrl}/app/acceso`,
  }),
  questionAnswered: ({ name, moduleNumber }) => ({
    subject: `El equipo QLC respondió tu consulta del Módulo ${moduleNumber}`,
    title: 'Tu consulta tiene respuesta',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Ya puedes leer la respuesta en la pestaña Ejercicio y avance del Módulo ${escapeHtml(String(moduleNumber))}.</p>${button(`${env.frontendUrl}/app/academia/m/${moduleNumber}`, 'Ver la respuesta')}`,
    text: `Hola ${name}, el equipo QLC respondió tu consulta del Módulo ${moduleNumber}.`,
  }),
  exerciseAnswered: ({ name, moduleNumber }) => ({
    subject: `El equipo QLC respondió tu ejercicio del Módulo ${moduleNumber}`,
    title: 'Tu ejercicio tiene respuesta',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Ya puedes leer la respuesta en la pestaña Ejercicio y avance del Módulo ${escapeHtml(String(moduleNumber))}.</p>${button(`${env.frontendUrl}/app/academia/m/${moduleNumber}`, 'Ver la respuesta')}`,
    text: `Hola ${name}, el equipo QLC respondió tu ejercicio del Módulo ${moduleNumber}.`,
  }),
  appointmentUpdate: ({ name, status, scheduledAt }) => ({
    subject: `Tu cita de asesoría: ${status}`,
    title: `Cita ${status.toLowerCase()}`,
    body: `<p>Hola ${escapeHtml(name)},</p><p>Tu cita de asesoría del ${escapeHtml(new Date(scheduledAt).toISOString().slice(0, 16).replace('T', ' '))} UTC quedó: <b>${escapeHtml(status)}</b>.</p>${button(`${env.frontendUrl}/app/asesoria`, 'Ver mis citas')}`,
    text: `Hola ${name}, tu cita de asesoría quedó: ${status}.`,
  }),
  giftRedeemed: ({ name, product, recipient }) => ({
    subject: 'Tu regalo de QLC fue activado',
    title: 'Tu regalo fue activado',
    body: `<p>Hola ${escapeHtml(name)},</p><p>${escapeHtml(recipient || 'La persona que recibió tu regalo')} activó su acceso a <b>${escapeHtml(product)}</b>. Gracias por regalar educación financiera.</p>`,
    text: `Hola ${name}, tu regalo de ${product} fue activado.`,
  }),
  passwordReset: ({ name, code, minutes }) => ({
    subject: `${code} es tu código para restablecer tu contraseña · QLC`,
    title: 'Restablece tu contraseña',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Escribe este código en la pestaña Restablecer contraseña de la página de inicio de sesión:</p><p style="margin:22px 0;font-size:32px;letter-spacing:10px;font-weight:700;color:#5bd4ff">${escapeHtml(code)}</p><p>El código vence en ${minutes} minutos. Al restablecer tu contraseña también se reinicia tu Google Authenticator y deberás registrarlo de nuevo al iniciar sesión.</p><p>Si no lo solicitaste, ignora este mensaje: tu cuenta sigue igual.</p>`,
    text: `Tu código para restablecer tu contraseña de QLC es ${code}. Vence en ${minutes} minutos. Si no lo solicitaste, ignora este mensaje.`,
  }),
  passwordChanged: ({ name }) => ({
    subject: 'Tu contraseña de QLC se restableció',
    title: 'Tu contraseña se restableció',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Tu contraseña se cambió y tu Google Authenticator se reinició. Al iniciar sesión deberás registrarlo de nuevo.</p><p>Si no fuiste tú, contacta de inmediato al equipo de QLC.</p>${button(`${env.frontendUrl}/login`, 'Iniciar sesión')}`,
    text: `Hola ${name}, tu contraseña de QLC se restableció y tu Google Authenticator se reinició. Si no fuiste tú, contacta de inmediato al equipo de QLC.`,
  }),
  test: ({ name }) => ({
    subject: 'Correo de prueba · QLC Financial Education',
    title: 'Integración de Gmail funcionando',
    body: `<p>Este correo confirma que la cuenta conectada puede enviar notificaciones del sistema.</p><p>Solicitado por ${escapeHtml(name)}.</p>`,
    text: 'Integración de Gmail funcionando.',
  }),
};

export async function sendClientEmail(type, template, to, data = {}) {
  const settings = await notificationSettings();
  if (settings.clientDisabled?.includes(type)) return { sent: false, skipped: true };
  return sendEmail(template, to, data);
}

export async function sendEmail(template, to, data = {}) {
  const content = TEMPLATES[template](data);
  if (env.isTest && testReady) {
    testEmail.outbox.push({ template, to, data });
    return { sent: true };
  }
  try {
    const [settings, transport] = await Promise.all([notificationSettings(), mailTransport()]);
    const html = layout(content.title, content.body);
    if (transport.method === 'SMTP') {
      if (!transport.email || !transport.encryptedPassword) throw new Error('Falta la cuenta de Gmail o la contraseña de aplicación');
      const smtp = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: transport.email, pass: smtpPassword(transport) }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
      await smtp.sendMail({ from: { name: settings.senderName || 'QLC', address: transport.email }, to, subject: content.subject, html, text: content.text });
    } else {
      const gmail = await prisma.googleIntegration.findUnique({ where: { service: 'GMAIL' } });
      const from = gmail?.email && settings.senderName ? `${'=?UTF-8?B?' + Buffer.from(settings.senderName, 'utf8').toString('base64') + '?='} <${gmail.email}>` : null;
      await sendGmail({ to, subject: content.subject, html, text: content.text, from });
    }
    await prisma.emailLog.create({ data: { to, subject: content.subject, template, status: 'SENT' } });
    return { sent: true };
  } catch (err) {
    await prisma.emailLog.create({ data: { to, subject: content.subject, template, status: 'FAILED', error: err.message.slice(0, 300) } }).catch(() => null);
    if (!env.isProd) console.info(`[email] ${template} → ${to} no enviado: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

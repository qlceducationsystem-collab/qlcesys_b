import { env } from '../config/env.js';

export const EMAIL_LANGUAGES = ['es', 'en'];
export const normalizeLang = (lang) => (EMAIL_LANGUAGES.includes(lang) ? lang : 'es');

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FOOTER = {
  es: 'Herramienta educativa y de organización financiera. No constituye asesoría financiera.',
  en: 'Educational and financial organization tool. It does not constitute financial advice.',
};

export const layout = (title, body, lang = 'es') => `<!doctype html><html lang="${normalizeLang(lang)}"><body style="margin:0;background:#05070a;font-family:Segoe UI,Arial,sans-serif;color:#f4f7fb">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0d131a;border:1px solid #1f2a36;border-radius:16px">
<tr><td style="padding:28px 32px 8px;color:#5bd4ff;font-size:11px;letter-spacing:3px;font-weight:700">QLC FINANCIAL EDUCATION</td></tr>
<tr><td style="padding:0 32px;font-size:22px;font-weight:700">${escapeHtml(title)}</td></tr>
<tr><td style="padding:16px 32px 28px;color:#c7ccd2;font-size:14px;line-height:1.6">${body}</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #1f2a36;color:#6f7c89;font-size:11px">${FOOTER[normalizeLang(lang)]}</td></tr>
</table></td></tr></table></body></html>`;

const button = (href, label) =>
  `<p style="margin:22px 0"><a href="${href}" style="background:#0094dc;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:600">${escapeHtml(label)}</a></p>`;

const LOCALE = { es: 'es-MX', en: 'en-US' };
const money = (n, lang) => (n === null || n === undefined ? '—' : `$${new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n))}`);
const when = (d, lang) => new Date(d).toLocaleString(LOCALE[lang], { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' });
const utc = (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ');
const row = (label, value) => `<tr><td style="padding:6px 0;color:#6f7c89;width:38%">${escapeHtml(label)}</td><td style="padding:6px 0;color:#f4f7fb">${escapeHtml(value ?? '—')}</td></tr>`;
const codeBlock = (code, spacing = 10, size = 32) => `<p style="margin:22px 0;font-size:${size}px;letter-spacing:${spacing}px;font-weight:700;color:#5bd4ff">${escapeHtml(code)}</p>`;

const EVENT_LABELS_EN = {
  CONTRATADA: 'Subscription requested',
  PAGO_EXITOSO: 'Payment successful',
  ACTIVADA: 'Subscription activated',
  RENOVADA: 'Subscription renewed',
  VENCIDA: 'Subscription expired',
  CANCELADA: 'Subscription cancelled',
  PAGO_FALLIDO: 'Payment failed',
  RECUPERADA: 'Subscription recovered',
  IMPORTE_NO_COINCIDE: 'Payment with an unexpected amount',
  PAGO_REVERTIDO: 'Payment refunded or charged back',
  PASARELA_CONFIGURADA: 'Payment gateway settings changed',
  BITGET_REPORTADA: 'Bitget internal transfer reported',
  BITGET_RECIBIDA: 'Bitget transfer received',
  BITGET_CONFIRMADA: 'Bitget payment confirmed',
  BITGET_RECHAZADA: 'Bitget report rejected',
  BITGET_ELIMINADA: 'Bitget report deleted',
  PROMOCION_CREADA: 'Promotion created',
  PROMOCION_ENVIADA: 'Promotion sent by email',
  PROMOCION_CANCELADA: 'Promotion cancelled',
  PAGO_PROMOCIONAL: 'Promotional payment confirmed',
  ACCESO_CONCEDIDO: 'Access granted',
  VENCIMIENTO_MODIFICADO: 'Expiration date changed',
  ACCESO_RETIRADO: 'Access removed',
  ACCESO_AUTORIZADO: 'Promotional access authorized',
  AUTORIZACION_RECHAZADA: 'Promotional payment not authorized',
  CONTRASENA_MAESTRA: 'Master password set',
  CONTRASENA_MAESTRA_CAMBIADA: 'Master password updated',
  AUTORIZACION_FALLIDA: 'Failed authorization attempt',
  REGALO_COMPRADO: 'Gift purchased',
  REGALO_CANJEADO: 'Gift redeemed',
  REGALO_CANCELADO: 'Gift cancelled',
  NUEVO_REGISTRO: 'New user registered',
  SERVICIO_COMPRADO: 'Question or guidance session purchased',
  NUEVA_CONSULTA: 'New question about exercises',
  AVISO_RENOVACION: 'Renewal notice sent to the client',
  CUENTA_ELIMINADA_INACTIVIDAD: 'Account deleted for not renewing',
  NUEVA_SOLICITUD: 'New information request',
  NUEVA_CITA: 'New advisory appointment',
  CITA_CANCELADA: 'Advisory appointment cancelled',
  EJERCICIO_ENVIADO: 'Exercise or question submitted',
  MODULO_COMPLETADO: 'Module completed',
  DATOS_COMPARTIDOS: 'Client shared their data',
  EDICION_AUTORIZADA: 'Client authorized changes to their data',
  DATOS_MODIFICADOS: 'Administrator changed client data',
  CUENTA_ELIMINADA: 'Account deleted by the client',
  MASTERCLASS_TERMINADA: 'Client finished a Masterclass',
  CONTRASENA_RESTABLECIDA: 'Client reset their password by email',
};

const MODULE_TITLES_EN = {
  Fundamentos: 'Fundamentals',
  'Productos financieros': 'Financial products',
  'Construcción de portafolio': 'Portfolio construction',
  'Inversiones de mayor riesgo': 'Higher-risk investments',
  Trading: 'Trading',
  'Operación profesional': 'Professional operation',
  'Presupuesto y control financiero': 'Budget and financial control',
  'Fondo de emergencia, Meta patrimonial y Liquidez': 'Emergency fund, Wealth goal and Liquidity',
  'Deudas y costo del dinero': 'Debts and the cost of money',
  'Impuestos y costo real': 'Taxes and real cost',
  'Inflación y poder adquisitivo': 'Inflation and purchasing power',
  'Plan patrimonial anual': 'Annual wealth plan',
};

const PRODUCTS_EN = {
  'Herramientas financieras QLC': 'QLC financial tools',
  'Solo herramientas': 'Tools only',
  'Consulta sobre ejercicios y avance': 'Question about exercises and progress',
  'Orientación financiera personalizada · 20 min': 'Personal financial guidance · 20 min',
  'Masterclass QLC · 12 módulos': 'QLC Masterclass · 12 modules',
};

const EXACT_EN = {
  Activo: 'Active',
  Cancelada: 'Cancelled',
  Cancelado: 'Cancelled',
  'Cancelado · acceso vigente hasta su vencimiento': 'Cancelled · access valid until it expires',
  'Compartiendo datos': 'Sharing data',
  'Cuenta creada': 'Account created',
  Desactivado: 'Deactivated',
  Eliminada: 'Deleted',
  'Pago pendiente': 'Payment pending',
  Rechazado: 'Rejected',
  Restablecida: 'Reset',
  'Sin acceso': 'No access',
  'Sin activar': 'Not activated',
  Vencido: 'Expired',
  'Pendiente de autorización': 'Pending authorization',
  Actualizada: 'Updated',
  'Contraseña maestra incorrecta': 'Incorrect master password',
  'El usuario reactivó su suscripción': 'The user reactivated their subscription',
  'Por código enviado al correo. Debe registrar de nuevo Google Authenticator.': 'With a code sent by email. They must register Google Authenticator again.',
  'Recuperado con promoción': 'Recovered with a promotion',
  'Compra de regalo': 'Gift purchase',
  'Pago promocional': 'Promotional payment',
  'Pago exitoso': 'Payment successful',
  'Pago exitoso · renovación': 'Payment successful · renewal',
  'Pago exitoso · recuperación': 'Payment successful · recovery',
  'Pago exitoso · primera compra': 'Payment successful · first purchase',
  'No autorizado': 'Not authorized',
  'Retiro manual': 'Removed manually',
  Reembolsado: 'Refunded',
  Contracargo: 'Charged back',
  'El acceso sigue activo: revísalo en Control de accesos': 'Access is still active: review it in Access control',
  'Configuración de Mercado Pago modificada': 'Mercado Pago settings changed',
  Cortesía: 'Courtesy',
  'Beneficio especial': 'Special benefit',
  'Promoción comercial': 'Commercial promotion',
  'Compensación al cliente': 'Client compensation',
  Invitación: 'Invitation',
  'Autorización especial': 'Special authorization',
};

const PATTERNS_EN = [
  [/^Masterclass · Módulo (\d+)$/, (_, n) => `Masterclass · Module ${n}`],
  [/^Módulo (\d+) · (.+)$/, (_, n, title) => `Module ${n} · ${MODULE_TITLES_EN[title] || title}`],
  [/^Módulo (\d+)$/, (_, n) => `Module ${n}`],
  [/^Autorizado hasta (\S+) · (.+)$/, (_, d, rest) => `Authorized until ${d} · ${rest.split(' · ').map((p) => EXACT_EN[p] || p).join(' · ')}`],
  [/^Autorizado hasta (\S+)$/, (_, d) => `Authorized until ${d}`],
  [/^Vigente hasta (\S+)$/, (_, d) => `Valid until ${d}`],
  [/^Venció el (\S+)$/, (_, d) => `Expired on ${d}`],
  [/^Código (\S+) · vence (\S+)$/, (_, c, d) => `Code ${c} · expires ${d}`],
  [/^Código (\S+)$/, (_, c) => `Code ${c}`],
  [/^Se esperaba ([\d.,]+(?: [A-Z]+)?); el acceso no se activó$/, (_, a) => `Expected ${a}; access was not activated`],
  [/^Sin renovación (\d+) días después del vencimiento$/, (_, n) => `Not renewed ${n} days after expiring`],
  [/^Aviso enviado: quedan (\d+) día\(s\) antes de eliminar la cuenta$/, (_, n) => `Notice sent: ${n} day(s) left before the account is deleted`],
  [/^(\d+) código\(s\) disponible\(s\)$/, (_, n) => `${n} code(s) available`],
  [/^(\d+) disponible\(s\)$/, (_, n) => `${n} available`],
  [/^(\d+)% de descuento$/, (_, n) => `${n}% discount`],
  [/^(.+) quedó como Administrador General$/, (_, name) => `${name} is now the General Administrator`],
  [/^Confirmado · (\d+)% · código (\S+) · requiere autorización del Administrador General$/, (_, p, c) => `Confirmed · ${p}% · code ${c} · requires authorization from the General Administrator`],
  [/^De (\S+(?: \S+)?) a (\S+)(?: · (.+))?$/, (_, a, b, note) => `From ${a === 'sin vencimiento' ? 'no expiration' : a} to ${b}${note ? ` · ${note}` : ''}`],
];

export function translateValue(value, lang) {
  if (lang !== 'en' || typeof value !== 'string') return value;
  if (EXACT_EN[value]) return EXACT_EN[value];
  if (PRODUCTS_EN[value]) return PRODUCTS_EN[value];
  for (const [pattern, replace] of PATTERNS_EN) {
    const match = value.match(pattern);
    if (match) return replace(...match);
  }
  return value;
}

const productName = (name, lang) => translateValue(name, lang);

const PERIOD = {
  es: { ANUAL: 'Anual', MENSUAL: 'Mensual' },
  en: { ANUAL: 'Annual', MENSUAL: 'Monthly' },
};
const periodLabel = (period, lang) => (period ? PERIOD[lang][period] || (lang === 'en' ? period.replace('DÍAS', 'days') : period) : '—');

const APPOINTMENT = {
  es: { PENDING: 'Pendiente', CONFIRMED: 'Confirmada', CANCELLED: 'Cancelada', RESCHEDULED: 'Reprogramada', UPDATED: 'Actualizada' },
  en: { PENDING: 'Pending', CONFIRMED: 'Confirmed', CANCELLED: 'Cancelled', RESCHEDULED: 'Rescheduled', UPDATED: 'Updated' },
};

const url = (path) => `${env.frontendUrl}${path}`;

const ES = {
  adminEvent: (e) => {
    const label = e.label;
    return {
      subject: `${label} · ${e.userName || e.userEmail || 'QLC'}`,
      title: label,
      body: `<table width="100%" cellpadding="0" cellspacing="0">${[
        row('Nombre', e.userName),
        row('Correo', e.userEmail),
        row('Producto', e.product),
        row('Suscripción', periodLabel(e.period, 'es')),
        row('Estado', e.status),
        row('Fecha', when(e.createdAt, 'es')),
        row('Importe', e.amount === null ? '—' : money(e.amount, 'es')),
        ...(e.result ? [row('Resultado', e.result)] : []),
      ].join('')}</table>${button(url('/admin/suscriptores'), 'Abrir panel de suscriptores')}`,
      text: `${label}. ${e.userName || ''} ${e.userEmail || ''}. Producto: ${e.product || '—'}. Estado: ${e.status || '—'}. Importe: ${e.amount === null ? '—' : money(e.amount, 'es')}.`,
    };
  },
  promotion: ({ name, discount, product, code, validUntil, message }) => ({
    subject: `Regresa a QLC con ${discount}% de descuento`,
    title: `Regresa a QLC con ${discount}% de descuento`,
    body: `<p>Hola ${escapeHtml(name)},</p><p>${escapeHtml(message || `Queremos invitarte a regresar a QLC. Reactiva tu acceso con un beneficio especial del ${discount}% de descuento en tu renovación.`)}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border:1px solid #1f2a36;border-radius:12px"><tr><td style="padding:16px 18px">
<div style="color:#6f7c89;font-size:11px;letter-spacing:2px">DESCUENTO</div><div style="font-size:30px;font-weight:700;color:#5bd4ff">${discount}%</div>
<div style="margin-top:8px">Producto: <b>${escapeHtml(product)}</b></div>
<div>Código: <b style="letter-spacing:2px">${escapeHtml(code)}</b></div>
<div>Válido hasta: ${escapeHtml(when(validUntil, 'es'))}</div></td></tr></table>
${button(url(`/app/acceso?promo=${encodeURIComponent(code)}`), 'Usar mi promoción')}
<p style="font-size:12px;color:#6f7c89">Promoción personalizada y sujeta a vigencia. Al pagar, tu acceso se activa una vez que el equipo de QLC lo autorice. Si no deseas recibir promociones, desactívalas en Mi acceso.</p>`,
    text: `Hola ${name}, regresa a QLC con ${discount}% de descuento en ${product}. Código: ${code}. Válido hasta ${when(validUntil, 'es')}.`,
  }),
  giftCodes: ({ name, product, codes, redeemBy }) => ({
    subject: 'Tus códigos de regalo de QLC',
    title: 'Tu regalo está listo',
    body: `<p>Hola ${escapeHtml(name)}, gracias por regalar conocimiento financiero.</p><p>Producto: <b>${escapeHtml(product)}</b></p>
${codes.map((c) => codeBlock(c, 3, 22)).join('')}
<p>Comparte el código con la persona que quieres obsequiar. Puede canjearlo hasta el ${escapeHtml(when(redeemBy, 'es'))} en:</p>${button(url('/regalo'), 'Canjear código de regalo')}`,
    text: `Tus códigos de regalo QLC (${product}): ${codes.join(', ')}. Canjéalos en ${url('/regalo')}`,
  }),
  verifyEmail: ({ code, minutes }) => ({
    subject: `${code} es tu código de verificación · QLC`,
    title: 'Confirma tu correo electrónico',
    body: `<p>Usa este código para terminar de crear tu cuenta:</p>${codeBlock(code)}<p>El código vence en ${minutes} minutos. Si no solicitaste una cuenta, ignora este mensaje.</p>`,
    text: `Tu código de verificación de QLC es ${code}. Vence en ${minutes} minutos.`,
  }),
  welcome: ({ name }) => ({
    subject: 'Bienvenido a QLC Financial Education',
    title: `Hola, ${name}`,
    body: `<p>Tu cuenta fue creada correctamente. Desde tu plataforma podrás registrar tu situación financiera y avanzar en tu programa educativo.</p>${button(url('/app'), 'Entrar a mi plataforma')}`,
    text: `Hola ${name}, tu cuenta en QLC Financial Education fue creada. Entra en ${url('/app')}`,
  }),
  retention: ({ name, left, deleteOn, product }) => ({
    subject: left === 1 ? 'Último aviso: mañana se elimina tu cuenta QLC' : `Tu cuenta QLC se elimina en ${left} días`,
    title: left === 1 ? 'Queda 1 día para renovar' : `Quedan ${left} días para renovar`,
    body: `<p>Hola ${escapeHtml(name)},</p><p>Tu suscripción${product ? ` a <b>${escapeHtml(product)}</b>` : ''} terminó. Si no la renuevas, el ${escapeHtml(when(deleteOn, 'es'))} el sistema eliminará tu cuenta y toda la información que registraste en la plataforma.</p><p>Renueva ahora para conservar tu avance, tus registros y tu historial.</p>${button(url('/app/acceso'), 'Renovar mi acceso')}`,
    text: `Hola ${name}, tu suscripción QLC terminó. Quedan ${left} día(s): si no renuevas, el ${when(deleteOn, 'es')} se eliminará tu cuenta y tu información. Renueva en ${url('/app/acceso')}`,
  }),
  accessActivated: ({ name, product, expiresAt }) => ({
    subject: `Tu acceso a ${product} está activo`,
    title: 'Tu acceso está activo',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Ya puedes usar <b>${escapeHtml(product)}</b>${expiresAt ? ` hasta el ${escapeHtml(when(expiresAt, 'es'))}` : ''}.</p>${button(url('/app'), 'Entrar a mi plataforma')}`,
    text: `Hola ${name}, tu acceso a ${product} está activo${expiresAt ? ` hasta el ${when(expiresAt, 'es')}` : ''}.`,
  }),
  serviceCredits: ({ name, product, quantity }) => ({
    subject: `Tu compra de ${product} está disponible`,
    title: 'Compra disponible',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Ya tienes disponible: <b>${escapeHtml(String(quantity))} × ${escapeHtml(product)}</b>.</p>${button(url('/app'), 'Entrar a mi plataforma')}`,
    text: `Hola ${name}, ya tienes disponible ${quantity} x ${product}.`,
  }),
  bitgetRejected: ({ name, product, orderNumber, reason }) => ({
    subject: 'Revisa tu reporte de transferencia Bitget',
    title: 'Tu reporte necesita una corrección',
    body: `<p>Hola ${escapeHtml(name)},</p><p>No pudimos confirmar tu transferencia con N.º de orden <b>${escapeHtml(orderNumber)}</b> para <b>${escapeHtml(product)}</b>.</p>${reason ? `<p>Motivo: ${escapeHtml(reason)}</p>` : ''}<p>Entra a Mi acceso y pulsa Corregir reporte para enviar los datos correctos.</p>${button(url('/app/acceso'), 'Corregir mi reporte')}`,
    text: `Hola ${name}, no pudimos confirmar tu transferencia ${orderNumber}.${reason ? ` Motivo: ${reason}.` : ''} Corrige tu reporte en ${url('/app/acceso')}`,
  }),
  renewalDue: ({ name, product, offerCode, expiresAt }) => ({
    subject: 'Tu acceso a QLC está por vencer: renueva tu pago',
    title: 'Tu acceso está por vencer',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Tu acceso a <b>${escapeHtml(product)}</b> vence el ${escapeHtml(new Date(expiresAt).toISOString().slice(0, 10))}. Este pago no se renueva solo: realízalo a tiempo para no perder el acceso.</p>${button(url(`/app/acceso?renovar=${encodeURIComponent(offerCode)}`), 'Renovar mi acceso')}`,
    text: `Hola ${name}, tu acceso a ${product} vence el ${new Date(expiresAt).toISOString().slice(0, 10)}. Renueva en ${url(`/app/acceso?renovar=${encodeURIComponent(offerCode)}`)}`,
  }),
  accessExpired: ({ name, product }) => ({
    subject: 'Tu suscripción de QLC venció',
    title: 'Tu suscripción venció',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Tu acceso${product ? ` a <b>${escapeHtml(product)}</b>` : ''} terminó. Renueva para seguir usando la plataforma y conservar tu información.</p>${button(url('/app/acceso'), 'Renovar mi acceso')}`,
    text: `Hola ${name}, tu acceso${product ? ` a ${product}` : ''} terminó. Renueva en ${url('/app/acceso')}`,
  }),
  questionAnswered: ({ name, moduleNumber }) => ({
    subject: `El equipo QLC respondió tu consulta del Módulo ${moduleNumber}`,
    title: 'Tu consulta tiene respuesta',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Ya puedes leer la respuesta en la pestaña Ejercicio y avance del Módulo ${escapeHtml(String(moduleNumber))}.</p>${button(url(`/app/academia/m/${moduleNumber}`), 'Ver la respuesta')}`,
    text: `Hola ${name}, el equipo QLC respondió tu consulta del Módulo ${moduleNumber}.`,
  }),
  exerciseAnswered: ({ name, moduleNumber }) => ({
    subject: `El equipo QLC respondió tu ejercicio del Módulo ${moduleNumber}`,
    title: 'Tu ejercicio tiene respuesta',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Ya puedes leer la respuesta en la pestaña Ejercicio y avance del Módulo ${escapeHtml(String(moduleNumber))}.</p>${button(url(`/app/academia/m/${moduleNumber}`), 'Ver la respuesta')}`,
    text: `Hola ${name}, el equipo QLC respondió tu ejercicio del Módulo ${moduleNumber}.`,
  }),
  appointmentUpdate: ({ name, status, scheduledAt }) => {
    const label = APPOINTMENT.es[status] || APPOINTMENT.es.UPDATED;
    return {
      subject: `Tu cita de asesoría: ${label}`,
      title: `Cita ${label.toLowerCase()}`,
      body: `<p>Hola ${escapeHtml(name)},</p><p>Tu cita de asesoría del ${escapeHtml(utc(scheduledAt))} UTC quedó: <b>${escapeHtml(label)}</b>.</p>${button(url('/app/asesoria'), 'Ver mis citas')}`,
      text: `Hola ${name}, tu cita de asesoría quedó: ${label}.`,
    };
  },
  giftRedeemed: ({ name, product, recipient }) => ({
    subject: 'Tu regalo de QLC fue activado',
    title: 'Tu regalo fue activado',
    body: `<p>Hola ${escapeHtml(name)},</p><p>${escapeHtml(recipient || 'La persona que recibió tu regalo')} activó su acceso a <b>${escapeHtml(product)}</b>. Gracias por regalar educación financiera.</p>`,
    text: `Hola ${name}, tu regalo de ${product} fue activado.`,
  }),
  passwordReset: ({ name, code, minutes }) => ({
    subject: `${code} es tu código para restablecer tu contraseña · QLC`,
    title: 'Restablece tu contraseña',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Escribe este código en la pestaña Restablecer contraseña de la página de inicio de sesión:</p>${codeBlock(code)}<p>El código vence en ${minutes} minutos. Al restablecer tu contraseña también se reinicia tu Google Authenticator y deberás registrarlo de nuevo al iniciar sesión.</p><p>Si no lo solicitaste, ignora este mensaje: tu cuenta sigue igual.</p>`,
    text: `Tu código para restablecer tu contraseña de QLC es ${code}. Vence en ${minutes} minutos. Si no lo solicitaste, ignora este mensaje.`,
  }),
  passwordChanged: ({ name }) => ({
    subject: 'Tu contraseña de QLC se restableció',
    title: 'Tu contraseña se restableció',
    body: `<p>Hola ${escapeHtml(name)},</p><p>Tu contraseña se cambió y tu Google Authenticator se reinició. Al iniciar sesión deberás registrarlo de nuevo.</p><p>Si no fuiste tú, contacta de inmediato al equipo de QLC.</p>${button(url('/login'), 'Iniciar sesión')}`,
    text: `Hola ${name}, tu contraseña de QLC se restableció y tu Google Authenticator se reinició. Si no fuiste tú, contacta de inmediato al equipo de QLC.`,
  }),
  test: ({ name }) => ({
    subject: 'Correo de prueba · QLC Financial Education',
    title: 'Integración de Gmail funcionando',
    body: `<p>Este correo confirma que la cuenta conectada puede enviar notificaciones del sistema.</p><p>Solicitado por ${escapeHtml(name)}.</p>`,
    text: 'Integración de Gmail funcionando.',
  }),
};

const EN = {
  adminEvent: (e) => {
    const label = EVENT_LABELS_EN[e.type] || e.label;
    const product = translateValue(e.product, 'en');
    const status = translateValue(e.status, 'en');
    return {
      subject: `${label} · ${e.userName || e.userEmail || 'QLC'}`,
      title: label,
      body: `<table width="100%" cellpadding="0" cellspacing="0">${[
        row('Name', e.userName),
        row('Email', e.userEmail),
        row('Product', product),
        row('Subscription', periodLabel(e.period, 'en')),
        row('Status', status),
        row('Date', when(e.createdAt, 'en')),
        row('Amount', e.amount === null ? '—' : money(e.amount, 'en')),
        ...(e.result ? [row('Result', translateValue(e.result, 'en'))] : []),
      ].join('')}</table>${button(url('/admin/suscriptores'), 'Open subscribers panel')}`,
      text: `${label}. ${e.userName || ''} ${e.userEmail || ''}. Product: ${product || '—'}. Status: ${status || '—'}. Amount: ${e.amount === null ? '—' : money(e.amount, 'en')}.`,
    };
  },
  promotion: ({ name, discount, product, code, validUntil, message }) => ({
    subject: `Come back to QLC with ${discount}% off`,
    title: `Come back to QLC with ${discount}% off`,
    body: `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(message || `We would like to invite you back to QLC. Reactivate your access with a special ${discount}% discount on your renewal.`)}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border:1px solid #1f2a36;border-radius:12px"><tr><td style="padding:16px 18px">
<div style="color:#6f7c89;font-size:11px;letter-spacing:2px">DISCOUNT</div><div style="font-size:30px;font-weight:700;color:#5bd4ff">${discount}%</div>
<div style="margin-top:8px">Product: <b>${escapeHtml(productName(product, 'en'))}</b></div>
<div>Code: <b style="letter-spacing:2px">${escapeHtml(code)}</b></div>
<div>Valid until: ${escapeHtml(when(validUntil, 'en'))}</div></td></tr></table>
${button(url(`/app/acceso?promo=${encodeURIComponent(code)}`), 'Use my promotion')}
<p style="font-size:12px;color:#6f7c89">Personal promotion, subject to its validity period. After you pay, your access is activated once the QLC team authorizes it. If you do not want to receive promotions, turn them off in My access.</p>`,
    text: `Hi ${name}, come back to QLC with ${discount}% off ${productName(product, 'en')}. Code: ${code}. Valid until ${when(validUntil, 'en')}.`,
  }),
  giftCodes: ({ name, product, codes, redeemBy }) => ({
    subject: 'Your QLC gift codes',
    title: 'Your gift is ready',
    body: `<p>Hi ${escapeHtml(name)}, thank you for giving financial knowledge.</p><p>Product: <b>${escapeHtml(productName(product, 'en'))}</b></p>
${codes.map((c) => codeBlock(c, 3, 22)).join('')}
<p>Share the code with the person you want to give it to. It can be redeemed until ${escapeHtml(when(redeemBy, 'en'))} at:</p>${button(url('/regalo'), 'Redeem gift code')}`,
    text: `Your QLC gift codes (${productName(product, 'en')}): ${codes.join(', ')}. Redeem them at ${url('/regalo')}`,
  }),
  verifyEmail: ({ code, minutes }) => ({
    subject: `${code} is your verification code · QLC`,
    title: 'Confirm your email',
    body: `<p>Use this code to finish creating your account:</p>${codeBlock(code)}<p>The code expires in ${minutes} minutes. If you did not request an account, ignore this message.</p>`,
    text: `Your QLC verification code is ${code}. It expires in ${minutes} minutes.`,
  }),
  welcome: ({ name }) => ({
    subject: 'Welcome to QLC Financial Education',
    title: `Hi, ${name}`,
    body: `<p>Your account was created successfully. From your platform you can record your financial situation and move forward in your educational program.</p>${button(url('/app'), 'Go to my platform')}`,
    text: `Hi ${name}, your QLC Financial Education account was created. Go to ${url('/app')}`,
  }),
  retention: ({ name, left, deleteOn, product }) => ({
    subject: left === 1 ? 'Final notice: your QLC account will be deleted tomorrow' : `Your QLC account will be deleted in ${left} days`,
    title: left === 1 ? '1 day left to renew' : `${left} days left to renew`,
    body: `<p>Hi ${escapeHtml(name)},</p><p>Your subscription${product ? ` to <b>${escapeHtml(productName(product, 'en'))}</b>` : ''} has ended. If you do not renew it, on ${escapeHtml(when(deleteOn, 'en'))} the system will delete your account and all the information you recorded on the platform.</p><p>Renew now to keep your progress, your records and your history.</p>${button(url('/app/acceso'), 'Renew my access')}`,
    text: `Hi ${name}, your QLC subscription has ended. ${left} day(s) left: if you do not renew, your account and information will be deleted on ${when(deleteOn, 'en')}. Renew at ${url('/app/acceso')}`,
  }),
  accessActivated: ({ name, product, expiresAt }) => ({
    subject: `Your access to ${productName(product, 'en')} is active`,
    title: 'Your access is active',
    body: `<p>Hi ${escapeHtml(name)},</p><p>You can now use <b>${escapeHtml(productName(product, 'en'))}</b>${expiresAt ? ` until ${escapeHtml(when(expiresAt, 'en'))}` : ''}.</p>${button(url('/app'), 'Go to my platform')}`,
    text: `Hi ${name}, your access to ${productName(product, 'en')} is active${expiresAt ? ` until ${when(expiresAt, 'en')}` : ''}.`,
  }),
  serviceCredits: ({ name, product, quantity }) => ({
    subject: `Your purchase of ${productName(product, 'en')} is available`,
    title: 'Purchase available',
    body: `<p>Hi ${escapeHtml(name)},</p><p>You now have available: <b>${escapeHtml(String(quantity))} × ${escapeHtml(productName(product, 'en'))}</b>.</p>${button(url('/app'), 'Go to my platform')}`,
    text: `Hi ${name}, you now have available ${quantity} x ${productName(product, 'en')}.`,
  }),
  bitgetRejected: ({ name, product, orderNumber, reason }) => ({
    subject: 'Please review your Bitget transfer report',
    title: 'Your report needs a correction',
    body: `<p>Hi ${escapeHtml(name)},</p><p>We could not confirm your transfer with order number <b>${escapeHtml(orderNumber)}</b> for <b>${escapeHtml(productName(product, 'en'))}</b>.</p>${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}<p>Go to My access and press Correct report to send the right details.</p>${button(url('/app/acceso'), 'Correct my report')}`,
    text: `Hi ${name}, we could not confirm your transfer ${orderNumber}.${reason ? ` Reason: ${reason}.` : ''} Correct your report at ${url('/app/acceso')}`,
  }),
  renewalDue: ({ name, product, offerCode, expiresAt }) => ({
    subject: 'Your QLC access is about to expire: renew your payment',
    title: 'Your access is about to expire',
    body: `<p>Hi ${escapeHtml(name)},</p><p>Your access to <b>${escapeHtml(productName(product, 'en'))}</b> expires on ${escapeHtml(new Date(expiresAt).toISOString().slice(0, 10))}. This payment does not renew automatically: make it in time to keep your access.</p>${button(url(`/app/acceso?renovar=${encodeURIComponent(offerCode)}`), 'Renew my access')}`,
    text: `Hi ${name}, your access to ${productName(product, 'en')} expires on ${new Date(expiresAt).toISOString().slice(0, 10)}. Renew at ${url(`/app/acceso?renovar=${encodeURIComponent(offerCode)}`)}`,
  }),
  accessExpired: ({ name, product }) => ({
    subject: 'Your QLC subscription has expired',
    title: 'Your subscription has expired',
    body: `<p>Hi ${escapeHtml(name)},</p><p>Your access${product ? ` to <b>${escapeHtml(productName(product, 'en'))}</b>` : ''} has ended. Renew to keep using the platform and keep your information.</p>${button(url('/app/acceso'), 'Renew my access')}`,
    text: `Hi ${name}, your access${product ? ` to ${productName(product, 'en')}` : ''} has ended. Renew at ${url('/app/acceso')}`,
  }),
  questionAnswered: ({ name, moduleNumber }) => ({
    subject: `The QLC team answered your question about Module ${moduleNumber}`,
    title: 'Your question has an answer',
    body: `<p>Hi ${escapeHtml(name)},</p><p>You can now read the answer in the Exercise and progress tab of Module ${escapeHtml(String(moduleNumber))}.</p>${button(url(`/app/academia/m/${moduleNumber}`), 'See the answer')}`,
    text: `Hi ${name}, the QLC team answered your question about Module ${moduleNumber}.`,
  }),
  exerciseAnswered: ({ name, moduleNumber }) => ({
    subject: `The QLC team answered your exercise from Module ${moduleNumber}`,
    title: 'Your exercise has an answer',
    body: `<p>Hi ${escapeHtml(name)},</p><p>You can now read the answer in the Exercise and progress tab of Module ${escapeHtml(String(moduleNumber))}.</p>${button(url(`/app/academia/m/${moduleNumber}`), 'See the answer')}`,
    text: `Hi ${name}, the QLC team answered your exercise from Module ${moduleNumber}.`,
  }),
  appointmentUpdate: ({ name, status, scheduledAt }) => {
    const label = APPOINTMENT.en[status] || APPOINTMENT.en.UPDATED;
    return {
      subject: `Your advisory appointment: ${label}`,
      title: `Appointment ${label.toLowerCase()}`,
      body: `<p>Hi ${escapeHtml(name)},</p><p>The status of your advisory appointment on ${escapeHtml(utc(scheduledAt))} UTC is: <b>${escapeHtml(label)}</b>.</p>${button(url('/app/asesoria'), 'See my appointments')}`,
      text: `Hi ${name}, the status of your advisory appointment is: ${label}.`,
    };
  },
  giftRedeemed: ({ name, product, recipient }) => ({
    subject: 'Your QLC gift was activated',
    title: 'Your gift was activated',
    body: `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(recipient || 'The person who received your gift')} activated their access to <b>${escapeHtml(productName(product, 'en'))}</b>. Thank you for giving financial education.</p>`,
    text: `Hi ${name}, your gift of ${productName(product, 'en')} was activated.`,
  }),
  passwordReset: ({ name, code, minutes }) => ({
    subject: `${code} is your code to reset your password · QLC`,
    title: 'Reset your password',
    body: `<p>Hi ${escapeHtml(name)},</p><p>Enter this code in the Reset password tab of the login page:</p>${codeBlock(code)}<p>The code expires in ${minutes} minutes. Resetting your password also resets your Google Authenticator, and you will have to register it again when you log in.</p><p>If you did not request this, ignore this message: your account stays the same.</p>`,
    text: `Your code to reset your QLC password is ${code}. It expires in ${minutes} minutes. If you did not request this, ignore this message.`,
  }),
  passwordChanged: ({ name }) => ({
    subject: 'Your QLC password was reset',
    title: 'Your password was reset',
    body: `<p>Hi ${escapeHtml(name)},</p><p>Your password was changed and your Google Authenticator was reset. You will have to register it again when you log in.</p><p>If this was not you, contact the QLC team immediately.</p>${button(url('/login'), 'Log in')}`,
    text: `Hi ${name}, your QLC password was reset and your Google Authenticator was reset. If this was not you, contact the QLC team immediately.`,
  }),
  test: ({ name }) => ({
    subject: 'Test email · QLC Financial Education',
    title: 'Gmail integration working',
    body: `<p>This email confirms that the connected account can send system notifications.</p><p>Requested by ${escapeHtml(name)}.</p>`,
    text: 'Gmail integration working.',
  }),
};

const BY_LANG = { es: ES, en: EN };

export const renderEmail = (template, data, lang = 'es') => BY_LANG[normalizeLang(lang)][template](data);

export const templateNames = () => Object.keys(ES);
export const englishTemplateNames = () => Object.keys(EN);

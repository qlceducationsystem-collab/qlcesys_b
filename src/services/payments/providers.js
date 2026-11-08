import { env } from '../../config/env.js';
import { HttpError } from '../../utils/httpError.js';
import { mpRequest } from './mercadopago.client.js';
import { convertForCharge, isTestToken, mercadoPagoToken, mpTesting, payerEmailFor, paymentSettings } from './paymentSettings.service.js';
import { paypalRequest } from './paypalSettings.service.js';
import { bitgetQuote, bitgetSettings, publicWallet } from './bitgetSettings.service.js';

const mockProvider = {
  code: 'MOCK',
  supportsManualResolution: true,
  async quote() {
    return null;
  },
  async createCheckout() {
    return { mode: 'SIMULATED' };
  },
};

const MP_STATUS = { approved: 'APPROVED', rejected: 'REJECTED', cancelled: 'REJECTED', refunded: 'REJECTED', charged_back: 'REJECTED' };
const REVERSED = ['refunded', 'charged_back'];
const isHttps = (url) => String(url).startsWith('https://');

const paymentResult = (payment) => ({
  attemptId: payment.external_reference,
  paymentId: String(payment.id),
  rawStatus: payment.status,
  statusDetail: payment.status_detail || null,
  reversed: REVERSED.includes(payment.status),
  status: MP_STATUS[payment.status] || 'PENDING',
  amount: payment.transaction_amount ?? null,
  currency: payment.currency_id || null,
});

const mercadoPagoProvider = {
  code: 'MERCADOPAGO',
  supportsManualResolution: false,
  async quote(amount, currency) {
    if (amount === null || amount === undefined) throw new HttpError(409, 'Este acceso todavía no tiene precio definido');
    return convertForCharge(amount, currency, await paymentSettings());
  },
  async createCheckout({ attempt, offer, user }) {
    const returnUrl = `${env.frontendUrl}/app/acceso?pago=${attempt.id}`;
    const webhook = isHttps(env.backendUrl) ? { notification_url: `${env.backendUrl}/api/webhooks/mercadopago` } : {};
    if (attempt.billingCycle) {
      const data = await mpRequest('/preapproval', {
        method: 'POST',
        idempotencyKey: attempt.id,
        body: {
          reason: String(offer.name).slice(0, 250),
          external_reference: attempt.id,
          payer_email: await payerEmailFor(user),
          auto_recurring: {
            frequency: attempt.billingCycle === 'YEARLY' ? 12 : 1,
            frequency_type: 'months',
            transaction_amount: Number(attempt.chargedAmount),
            currency_id: attempt.chargedCurrency,
          },
          back_url: returnUrl,
          status: 'pending',
        },
      });
      if (!data.init_point) throw new HttpError(502, 'Mercado Pago no entregó el enlace para contratar la suscripción');
      return { mode: 'REDIRECT', initPoint: data.init_point, subscription: { id: String(data.id), status: data.status, nextBillingAt: data.next_payment_date || null } };
    }
    const includePayer = !(await mpTesting()) || !!(await paymentSettings()).testPayerEmail;
    const data = await mpRequest('/checkout/preferences', {
      method: 'POST',
      idempotencyKey: attempt.id,
      body: {
        items: [{ id: offer.code, title: String(offer.name).slice(0, 250), quantity: 1, unit_price: Number(attempt.chargedAmount), currency_id: attempt.chargedCurrency }],
        ...(includePayer ? { payer: { email: await payerEmailFor(user) } } : {}),
        external_reference: attempt.id,
        back_urls: { success: returnUrl, pending: returnUrl, failure: returnUrl },
        ...(isHttps(returnUrl) ? { auto_return: 'approved' } : {}),
        statement_descriptor: 'QLC',
        ...webhook,
      },
    });
    const link = isTestToken(await mercadoPagoToken()) && data.sandbox_init_point ? data.sandbox_init_point : data.init_point;
    if (!link) throw new HttpError(502, 'Mercado Pago no entregó el enlace de pago');
    return { mode: 'REDIRECT', initPoint: link, providerRef: String(data.id) };
  },
  async getSubscription(id) {
    return mpRequest(`/preapproval/${encodeURIComponent(id)}`);
  },
  async cancelSubscription(id) {
    await mpRequest(`/preapproval/${encodeURIComponent(id)}`, { method: 'PUT', body: { status: 'canceled' } });
  },
  async fetchPaymentResult(paymentId, fetcher = mpRequest) {
    return paymentResult(await fetcher(`/v1/payments/${encodeURIComponent(paymentId)}`));
  },
  async searchByAttempt(attemptId, fetcher = mpRequest) {
    const data = await fetcher(`/v1/payments/search?external_reference=${encodeURIComponent(attemptId)}&sort=date_created&criteria=desc`);
    return (data.results || []).map(paymentResult);
  },
};

const paypalProvider = {
  code: 'PAYPAL',
  supportsManualResolution: false,
  getSubscription: (id) => paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(id)}`),
  async subscriptionSales(id, since) {
    const start = new Date(new Date(since).getTime() - 86400000).toISOString();
    const end = new Date(Date.now() + 3600000).toISOString();
    const data = await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(id)}/transactions?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`);
    return (data.transactions || []).filter((t) => t.status === 'COMPLETED').map((t) => ({ paymentId: String(t.id), amount: t.amount_with_breakdown?.gross_amount?.value ?? null, currency: t.amount_with_breakdown?.gross_amount?.currency_code ?? null }));
  },
  async cancelSubscription(id) {
    await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason: 'Cancelada por el cliente' } });
  },
};

const bitgetProvider = {
  code: 'BITGET',
  supportsManualResolution: false,
  quote: (amount, currency) => bitgetQuote(amount, currency),
  async createCheckout() {
    const settings = await bitgetSettings();
    return { mode: 'BITGET', uid: settings.uid, instructions: settings.instructions || null, wallet: await publicWallet() };
  },
};

export const MERCADOPAGO_COUNTRY = 'MX';

export async function anyGatewayEnabled() {
  const [mp, bitget] = await Promise.all([paymentSettings(), bitgetSettings()]);
  return !!(mp.enabled || bitget.enabled);
}

export async function activeProviders(user) {
  const [mp, bitget] = await Promise.all([paymentSettings(), bitgetSettings()]);
  return [
    ...(mp.enabled && user?.residenceCountry === MERCADOPAGO_COUNTRY ? [mercadoPagoProvider] : []),
    ...(bitget.enabled ? [bitgetProvider] : []),
  ];
}

export async function activeProvider(code, user) {
  const list = await activeProviders(user);
  if (code) {
    const found = list.find((p) => p.code === code);
    if (!found) throw new HttpError(409, 'Esta forma de pago no está disponible');
    return found;
  }
  if (list.length) return list[0];
  if (await anyGatewayEnabled()) throw new HttpError(409, 'Por ahora no hay una forma de pago disponible para tu país. Escríbenos para ayudarte.');
  return mockProvider;
}

const ALL = [mockProvider, mercadoPagoProvider, paypalProvider, bitgetProvider];
export const providerByCode = (code) => ALL.find((p) => p.code === code);
export { bitgetProvider, mercadoPagoProvider, paypalProvider };

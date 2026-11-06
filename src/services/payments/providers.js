import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/httpError.js';
import { mpRequest } from './mercadopago.client.js';
import { convertForCharge, isTestToken, mercadoPagoToken, paymentSettings } from './paymentSettings.service.js';

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
  async createCheckout({ attempt, offer, user, charge }) {
    const returnUrl = `${env.frontendUrl}/app/acceso?pago=${attempt.id}`;
    const preference = await mpRequest('/checkout/preferences', {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
      body: {
        items: [{ id: offer.code, title: offer.name, quantity: 1, unit_price: charge.amount, currency_id: charge.currency }],
        payer: { email: user.email },
        external_reference: attempt.id,
        ...(isHttps(env.backendUrl) ? { notification_url: `${env.backendUrl}/api/webhooks/mercadopago` } : {}),
        back_urls: { success: returnUrl, failure: returnUrl, pending: returnUrl },
        ...(isHttps(env.frontendUrl) ? { auto_return: 'approved' } : {}),
      },
    });
    const initPoint = isTestToken(await mercadoPagoToken()) ? preference.sandbox_init_point || preference.init_point : preference.init_point;
    return { mode: 'REDIRECT', initPoint, providerRef: String(preference.id) };
  },
  async fetchPaymentResult(paymentId, fetcher = mpRequest) {
    return paymentResult(await fetcher(`/v1/payments/${encodeURIComponent(paymentId)}`));
  },
  async searchByAttempt(attemptId, fetcher = mpRequest) {
    const data = await fetcher(`/v1/payments/search?external_reference=${encodeURIComponent(attemptId)}&sort=date_created&criteria=desc`);
    return (data.results || []).map(paymentResult);
  },
};

export async function activeProvider() {
  return (await paymentSettings()).enabled ? mercadoPagoProvider : mockProvider;
}

const ALL = [mockProvider, mercadoPagoProvider];
export const providerByCode = (code) => ALL.find((p) => p.code === code);
export { mercadoPagoProvider };

import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/httpError.js';
import { mpRequest } from './mercadopago.client.js';

const mockProvider = {
  code: 'MOCK',
  supportsManualResolution: true,
  async createCheckout() {
    return { mode: 'SIMULATED' };
  },
};

const MP_STATUS = { approved: 'APPROVED', rejected: 'REJECTED', cancelled: 'REJECTED', refunded: 'REJECTED', charged_back: 'REJECTED' };

const mercadoPagoProvider = {
  code: 'MERCADOPAGO',
  supportsManualResolution: false,
  async createCheckout({ attempt, offer, user }) {
    if (attempt.amount === null) throw new HttpError(409, 'Este acceso todavía no tiene precio definido');
    const preference = await mpRequest('/checkout/preferences', {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
      body: {
        items: [{ id: offer.code, title: offer.name, quantity: 1, unit_price: Number(attempt.amount), currency_id: attempt.currency }],
        payer: { email: user.email },
        external_reference: attempt.id,
        notification_url: `${env.backendUrl}/api/webhooks/mercadopago`,
        back_urls: { success: `${env.frontendUrl}/app/acceso`, failure: `${env.frontendUrl}/app/acceso`, pending: `${env.frontendUrl}/app/acceso` },
      },
    });
    return { mode: 'REDIRECT', initPoint: preference.init_point, providerRef: String(preference.id) };
  },
  async fetchPaymentResult(paymentId, fetcher = mpRequest) {
    const payment = await fetcher(`/v1/payments/${paymentId}`);
    return { attemptId: payment.external_reference, status: MP_STATUS[payment.status] || 'PENDING' };
  },
};

const PROVIDERS = { mock: mockProvider, mercadopago: mercadoPagoProvider };

export const activeProvider = () => PROVIDERS[env.paymentProvider] || mockProvider;
export const providerByCode = (code) => Object.values(PROVIDERS).find((p) => p.code === code);
export { mercadoPagoProvider };

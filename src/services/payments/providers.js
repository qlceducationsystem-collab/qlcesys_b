import { env } from '../../config/env.js';
import { mpRequest } from './mercadopago.client.js';
import { paypalRequest } from './paypalSettings.service.js';
import { DLOCAL_COUNTRIES, dlocalQuote, dlocalRequest, dlocalSettings } from './dlocalSettings.service.js';
import { badRequest } from '../../utils/httpError.js';

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

const DLOCAL_STATUS = { PAID: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'REJECTED', EXPIRED: 'REJECTED' };

const dlocalProvider = {
  code: 'DLOCALGO',
  supportsManualResolution: false,
  quote: (amount, currency) => dlocalQuote(amount, currency),
  async createCheckout({ attempt, offer, user, charge, country }) {
    if (!DLOCAL_COUNTRIES.includes(country)) throw badRequest('Elige tu país');
    const settings = await dlocalSettings();
    const payment = await dlocalRequest('/v1/payments', {
      method: 'POST',
      body: {
        amount: charge.amount,
        currency: charge.currency,
        country,
        order_id: attempt.id,
        description: String(offer.name).slice(0, 100),
        payer: { name: String(user.name || '').slice(0, 100), email: user.email, user_reference: user.id },
        success_url: `${env.frontendUrl}/app/acceso?pago=${attempt.id}`,
        back_url: `${env.frontendUrl}/app/acceso`,
        ...(isHttps(env.backendUrl) ? { notification_url: `${env.backendUrl}/api/webhooks/dlocalgo` } : {}),
        ...(settings.methods === 'NO_CARDS' ? { payment_type: 'BANK_TRANSFER,VOUCHER' } : {}),
      },
    });
    return { mode: 'REDIRECT', initPoint: payment.redirect_url, providerRef: String(payment.id) };
  },
  async fetchPayment(id) {
    const payment = await dlocalRequest(`/v1/payments/${encodeURIComponent(id)}`);
    return { id: String(payment.id), attemptId: payment.order_id, status: DLOCAL_STATUS[payment.status] || 'PENDING', amount: payment.amount, currency: payment.currency };
  },
  listChargebacks: async () => (await dlocalRequest('/v1/chargebacks')).data || [],
};

export async function activeProvider() {
  return (await dlocalSettings()).enabled ? dlocalProvider : mockProvider;
}

const ALL = [mockProvider, mercadoPagoProvider, paypalProvider, dlocalProvider];
export const providerByCode = (code) => ALL.find((p) => p.code === code);
export { dlocalProvider, mercadoPagoProvider, paypalProvider };

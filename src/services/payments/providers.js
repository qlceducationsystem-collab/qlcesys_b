import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/httpError.js';
import { mpRequest } from './mercadopago.client.js';
import { convertForCharge, paymentSettings } from './paymentSettings.service.js';
import { paypalQuote, paypalRequest, paypalSettings, writePaypalSettings } from './paypalSettings.service.js';

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

const challengeOf = (payment) => (payment.status_detail === 'pending_challenge' && payment.three_ds_info?.external_resource_url && payment.three_ds_info?.creq
  ? { url: payment.three_ds_info.external_resource_url, creq: payment.three_ds_info.creq }
  : null);

const paymentResult = (payment) => ({
  attemptId: payment.external_reference,
  paymentId: String(payment.id),
  rawStatus: payment.status,
  statusDetail: payment.status_detail || null,
  challenge: challengeOf(payment),
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
  async createCheckout() {
    const { publicKey } = await paymentSettings();
    if (!publicKey) throw new HttpError(409, 'Falta la Public Key. Configúrala en Pasarela de pago.');
    return { mode: 'CARD', publicKey };
  },
  async chargeCard({ attempt, offer, user, card }, fetcher = mpRequest) {
    const payment = await fetcher('/v1/payments', {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
      deviceId: card.deviceId,
      body: {
        transaction_amount: Number(attempt.chargedAmount),
        token: card.token,
        description: offer.name,
        installments: 1,
        payment_method_id: card.paymentMethodId,
        ...(card.issuerId ? { issuer_id: Number(card.issuerId) } : {}),
        payer: { email: user.email },
        external_reference: attempt.id,
        statement_descriptor: 'QLC',
        three_d_secure_mode: 'optional',
        capture: true,
        binary_mode: false,
        ...(isHttps(env.backendUrl) ? { notification_url: `${env.backendUrl}/api/webhooks/mercadopago` } : {}),
      },
    });
    return paymentResult(payment);
  },
  async createSubscription({ attempt, offer, user, card }) {
    const data = await mpRequest('/preapproval', {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
      deviceId: card.deviceId,
      body: {
        reason: offer.name,
        external_reference: attempt.id,
        payer_email: user.email,
        card_token_id: card.token,
        auto_recurring: {
          frequency: attempt.billingCycle === 'YEARLY' ? 12 : 1,
          frequency_type: 'months',
          transaction_amount: Number(attempt.chargedAmount),
          currency_id: attempt.chargedCurrency,
        },
        back_url: `${env.frontendUrl}/app/acceso`,
        status: 'authorized',
      },
    });
    return { id: String(data.id), status: data.status, nextBillingAt: data.next_payment_date || null };
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

const planKey = (offer, cycle, charge) => `${offer.code}:${cycle}:${charge.amount}:${charge.currency}`;

async function ensurePaypalProduct(settings) {
  if (settings.productId) return settings.productId;
  const product = await paypalRequest('/v1/catalogs/products', { method: 'POST', body: { name: 'QLC Financial Education', type: 'DIGITAL' } });
  await writePaypalSettings({ productId: product.id });
  return product.id;
}

async function ensurePaypalPlan(offer, cycle, charge) {
  const settings = await paypalSettings();
  const key = planKey(offer, cycle, charge);
  if (settings.plans?.[key]) return settings.plans[key];
  const productId = await ensurePaypalProduct(settings);
  const plan = await paypalRequest('/v1/billing/plans', {
    method: 'POST',
    body: {
      product_id: productId,
      name: String(offer.name).slice(0, 127),
      status: 'ACTIVE',
      billing_cycles: [{
        frequency: { interval_unit: cycle === 'YEARLY' ? 'YEAR' : 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: charge.amount.toFixed(2), currency_code: charge.currency } },
      }],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
    },
  });
  const latest = await paypalSettings();
  await writePaypalSettings({ plans: { ...(latest.plans || {}), [key]: plan.id } });
  return plan.id;
}

const paypalProvider = {
  code: 'PAYPAL',
  supportsManualResolution: false,
  quote: (amount, currency) => paypalQuote(amount, currency),
  async createCheckout() {
    const settings = await paypalSettings();
    return { mode: 'PAYPAL', clientId: settings.clientId, currency: settings.currency };
  },
  async createOrder({ attempt, offer }) {
    const order = await paypalRequest('/v2/checkout/orders', {
      method: 'POST',
      body: {
        intent: 'CAPTURE',
        purchase_units: [{
          custom_id: attempt.id,
          description: String(offer.name).slice(0, 127),
          amount: { currency_code: attempt.chargedCurrency, value: Number(attempt.chargedAmount).toFixed(2) },
        }],
      },
    });
    return String(order.id);
  },
  async captureOrder(orderId, attemptId) {
    const order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', requestId: `capture-${attemptId}`, body: {} });
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    return { status: capture?.status || order.status, paymentId: capture ? String(capture.id) : null, amount: capture?.amount?.value ?? null, currency: capture?.amount?.currency_code ?? null };
  },
  async createSubscription({ attempt, offer }) {
    const planId = await ensurePaypalPlan(offer, attempt.billingCycle, { amount: Number(attempt.chargedAmount), currency: attempt.chargedCurrency });
    const sub = await paypalRequest('/v1/billing/subscriptions', { method: 'POST', body: { plan_id: planId, custom_id: attempt.id } });
    return { id: String(sub.id) };
  },
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

export async function activeProviders() {
  const [mp, paypal] = await Promise.all([paymentSettings(), paypalSettings()]);
  return [...(mp.enabled ? [mercadoPagoProvider] : []), ...(paypal.enabled ? [paypalProvider] : [])];
}

export async function activeProvider(code) {
  const list = await activeProviders();
  if (code) {
    const found = list.find((p) => p.code === code);
    if (!found) throw new HttpError(409, 'Esta forma de pago no está disponible');
    return found;
  }
  return list[0] || mockProvider;
}

const ALL = [mockProvider, mercadoPagoProvider, paypalProvider];
export const providerByCode = (code) => ALL.find((p) => p.code === code);
export { mercadoPagoProvider, paypalProvider };

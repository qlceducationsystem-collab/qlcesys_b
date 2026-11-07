import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { HttpError } from '../../utils/httpError.js';
import { mpRequest } from './mercadopago.client.js';
import { convertForCharge, paymentSettings } from './paymentSettings.service.js';

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

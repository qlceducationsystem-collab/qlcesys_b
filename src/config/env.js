const isProd = process.env.NODE_ENV === 'production';
const trimUrl = (u) => (u || '').trim().replace(/\/$/, '');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

const jwtSecret = process.env.JWT_SECRET || (isProd ? required('JWT_SECRET') : 'dev-only-secret-change-me-0123456789');
const frontendUrls = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(trimUrl).filter(Boolean);
const backendUrl = trimUrl(process.env.BACKEND_URL || 'http://localhost:4000');

export const env = {
  isProd,
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT) || 4000,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  frontendUrls,
  frontendUrl: frontendUrls[0],
  backendUrl,
  paymentProvider: (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase(),
  mercadoPago: {
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
    publicKey: process.env.MERCADOPAGO_PUBLIC_KEY || '',
    webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'qlc-financial-education',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: trimUrl(process.env.GOOGLE_REDIRECT_URI) || `${backendUrl}/api/google/callback`,
  },
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',
  keepAlive: {
    enabled: process.env.KEEP_ALIVE ? process.env.KEEP_ALIVE === 'true' : isProd,
    url: trimUrl(process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL),
    intervalMinutes: Math.min(14, Math.max(1, Number(process.env.KEEP_ALIVE_INTERVAL_MINUTES) || 5)),
  },
};

export const googleConfigured = () => !!(env.google.clientId && env.google.clientSecret && env.tokenEncryptionKey);
export const cloudinaryConfigured = () => !!(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

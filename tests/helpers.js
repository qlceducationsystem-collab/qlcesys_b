import request from 'supertest';
import { codeAt, currentStep } from '../src/utils/totp.js';

process.env.TOKEN_ENCRYPTION_KEY ||= 'test-only-encryption-key-qlc-0123456789';

export async function completeTwoFactor(app, challengeToken) {
  const setup = await request(app).post('/api/auth/2fa/setup').send({ challengeToken });
  const activated = await request(app).post('/api/auth/2fa/activate').send({ challengeToken, code: codeAt(setup.body.secret, currentStep()) });
  return { token: activated.body.token, secret: setup.body.secret, setup, activated };
}

export const nextCode = (secret, offset = 1) => codeAt(secret, currentStep() + offset);

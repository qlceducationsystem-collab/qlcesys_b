import request from 'supertest';
import { codeAt, currentStep } from '../src/utils/totp.js';

process.env.TOKEN_ENCRYPTION_KEY ||= 'test-only-encryption-key-qlc-0123456789';

export async function completeTwoFactor(app, challengeToken) {
  const setup = await request(app).post('/api/auth/2fa/setup').send({ challengeToken });
  const activated = await request(app).post('/api/auth/2fa/activate').send({ challengeToken, code: codeAt(setup.body.secret, currentStep()) });
  return { token: activated.body.token, secret: setup.body.secret, setup, activated };
}

export async function completeModules(prisma, email, numbers) {
  const user = await prisma.user.findUnique({ where: { email } });
  const modules = await prisma.academyModule.findMany({ where: { month: { in: numbers } } });
  for (const mod of modules) {
    const data = { status: 'COMPLETED', completedAt: new Date() };
    await prisma.moduleProgress.upsert({ where: { userId_moduleId: { userId: user.id, moduleId: mod.id } }, create: { userId: user.id, moduleId: mod.id, ...data }, update: data });
  }
}

export const nextCode = (secret, offset = 1) => codeAt(secret, currentStep() + offset);

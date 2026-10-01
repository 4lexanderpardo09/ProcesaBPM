import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { RATE_LIMITS } from '../../src/modules/auth/domain/auth-policy.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment({ TRUST_PROXY: '1' });

describe('behind one trusted proxy (TRUST_PROXY=1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp({ rateLimiting: true }));
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (clientIp: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', clientIp)
      .send({ email: `ip-${clientIp}-${Math.random()}@example.com`, password: 'x' });

  it('limits each client IP from X-Forwarded-For separately', async () => {
    for (let attempt = 0; attempt < RATE_LIMITS.login.perIp.limit; attempt += 1) await login('198.51.100.7').expect(401);
    await login('198.51.100.7').expect(429);
    await login('198.51.100.8').expect(401);
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '../../src/modules/auth/domain/auth-policy.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('rate limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp({ rateLimiting: true }));
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (email: string) => request(app.getHttpServer()).post('/auth/login').send({ email, password: 'whatever!' });

  it('limits login attempts per e-mail and says when to retry', async () => {
    const email = `target-${Date.now()}@example.com`;
    for (let attempt = 0; attempt < RATE_LIMITS.login.perIdentifier.limit; attempt += 1) await login(email).expect(401);
    const response = await login(email).expect(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    await login(`other-${Date.now()}@example.com`).expect(401);
  });

  it('counts the e-mail in any case as the same account', async () => {
    const email = `case-${Date.now()}@example.com`;
    for (let attempt = 0; attempt < RATE_LIMITS.login.perIdentifier.limit; attempt += 1) await login(email).expect(401);
    await login(email.toUpperCase()).expect(429);
  });

  it('limits password reset requests per e-mail', async () => {
    const email = `reset-${Date.now()}@example.com`;
    const call = () => request(app.getHttpServer()).post('/auth/password-reset/request').send({ email });
    for (let attempt = 0; attempt < RATE_LIMITS.passwordReset.perIdentifier.limit; attempt += 1) await call().expect(202);
    await call().expect(429);
  });

  it('limits invitation attempts per token', async () => {
    const token = 'y'.repeat(43);
    const call = () => request(app.getHttpServer()).post('/auth/invitations/accept').send({ token });
    for (let attempt = 0; attempt < RATE_LIMITS.invitation.perIdentifier.limit; attempt += 1) await call().expect(400);
    await call().expect(429);
  });

  it('limits per IP across e-mails', async () => {
    const fresh = await createTestApp({ rateLimiting: true });
    try {
      const limit = RATE_LIMITS.login.perIp.limit;
      for (let attempt = 0; attempt < limit; attempt += 1) {
        await request(fresh.app.getHttpServer()).post('/auth/login').send({ email: `ip-${attempt}@example.com`, password: 'x' }).expect(401);
      }
      await request(fresh.app.getHttpServer()).post('/auth/login').send({ email: 'ip-last@example.com', password: 'x' }).expect(429);
    } finally {
      await fresh.app.close();
    }
  });
});

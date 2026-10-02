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

  it('limits tenant selection per selection token (a bearer route has no e-mail in the body)', async () => {
    const select = (token: string) => request(app.getHttpServer()).post('/auth/select-tenant').set('authorization', `Bearer ${token}`).send({ tenantId: '0197e5b2-0000-7000-8000-000000000001' });
    for (let attempt = 0; attempt < RATE_LIMITS.selectTenant.perIdentifier.limit; attempt += 1) await select('first.bearer.token').expect(401);
    const response = await select('first.bearer.token').expect(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
    await select('second.bearer.token').expect(401);
  });

  it('ignores X-Forwarded-For by default (TRUST_PROXY=false): it cannot be used to dodge the limit', async () => {
    const fresh = await createTestApp({ rateLimiting: true });
    try {
      // A different e-mail and a different forged client IP each time: only the per-IP limit can stop it.
      const attempt = (i: number) =>
        request(fresh.app.getHttpServer())
          .post('/auth/login')
          .set('x-forwarded-for', `203.0.113.${i}`)
          .send({ email: `spoof-${i}@example.com`, password: 'x' });
      for (let i = 0; i < RATE_LIMITS.login.perIp.limit; i += 1) await attempt(i).expect(401);
      await attempt(200).expect(429);
    } finally {
      await fresh.app.close();
    }
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

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '../../src/modules/auth/domain/auth-policy.js';
import { createTestApp } from '../support/create-test-app.js';
import { openUnauthenticatedConnection, startListening } from '../support/realtime-client.js';
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

  it('the realtime admission limits each client IP from X-Forwarded-For separately', async () => {
    const url = await startListening(app);
    const from = (clientIp: string) => openUnauthenticatedConnection(url, { 'x-forwarded-for': clientIp });
    const held: Array<{ close: () => void }> = [];
    try {
      for (let index = 0; index < 50; index += 1) {
        const connection = await from('198.51.100.20');
        if (connection instanceof Error) throw connection;
        held.push(connection);
      }
      expect(await from('198.51.100.20')).toBeInstanceOf(Error);
      const other = await from('198.51.100.21');
      expect(other).not.toBeInstanceOf(Error);
      if (!(other instanceof Error)) held.push(other);
    } finally {
      for (const connection of held) connection.close();
    }
  });
});

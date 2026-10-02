import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { PlatformPrismaService } from '../../src/infrastructure/database/platform-prisma.service.js';
import { PrismaService } from '../../src/infrastructure/database/prisma.service.js';
import { connectTestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import { randomUUID } from 'node:crypto';
import { AuthTokenPurgeJob } from '../../src/modules/auth/application/auth-token-purge.job.js';
import { seedUser } from '../support/auth-fixtures.js';
import { WorkerModule } from '../../src/worker.module.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment({ LOG_LEVEL: 'info' });

describe('worker', () => {
  it('starts and shuts down gracefully, releasing the database connections', async () => {
    const lines: string[] = [];
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LOG_WRITER)
      .useValue((line: string) => lines.push(line))
      .compile();

    await moduleRef.init();
    await moduleRef.close();

    expect(lines.map((line) => (JSON.parse(line) as { message: string }).message)).toEqual([
      'Worker started',
      'Worker stopped',
    ]);
  });

  it('needs neither PORT nor JWT_SECRET: the worker listens on nothing and signs no tokens', async () => {
    delete process.env.PORT;
    delete process.env.JWT_SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LOG_WRITER)
      .useValue(() => undefined)
      .compile();
    await moduleRef.init();
    await moduleRef.close();
  });

  it('connects with the worker login (app_worker), not the API one', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LOG_WRITER)
      .useValue(() => undefined)
      .compile();
    await moduleRef.init();
    try {
      const prisma = moduleRef.get(PrismaService, { strict: false });
      const [row] = await prisma.$queryRaw<{ role: string }[]>`SELECT current_user::text AS role`;
      expect(row?.role).toBe('app_worker');
    } finally {
      await moduleRef.close();
    }
  });

  it('has no platform (BYPASSRLS) client at all, even when the platform login is in the environment', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LOG_WRITER)
      .useValue(() => undefined)
      .compile();
    await moduleRef.init();
    try {
      expect(() => moduleRef.get(PlatformPrismaService, { strict: false })).toThrow();
    } finally {
      await moduleRef.close();
    }
  });

  it('forgets the ids of login tokens that expired long ago and keeps the recent ones', async () => {
    const db = connectTestDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LOG_WRITER)
      .useValue(() => undefined)
      .compile();
    await moduleRef.init();
    try {
      const user = await seedUser(db, await seedTenant(db.platform));
      await db.platform.query(
        `INSERT INTO consumed_auth_tokens (jti, user_id, purpose, expires_at) VALUES
           ($1, $3, 'TENANT_SELECTION', now() - interval '2 hours'), ($2, $3, 'TENANT_SELECTION', now() + interval '1 minute')`,
        [randomUUID(), randomUUID(), user.userId],
      );
      expect(await moduleRef.get(AuthTokenPurgeJob).runOnce()).toBeGreaterThanOrEqual(1);
      expect((await db.platform.query('SELECT 1 FROM consumed_auth_tokens WHERE user_id = $1', [user.userId])).rowCount).toBe(1);
    } finally {
      await moduleRef.close();
      await db.close();
    }
  });
});

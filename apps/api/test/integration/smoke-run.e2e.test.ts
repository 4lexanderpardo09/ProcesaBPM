import { createServer, type Server } from 'node:http';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { cleanUp } from '../../src/smoke/smoke-cleanup.js';
import { loadSmokeConfig, type SmokeConfig } from '../../src/smoke/smoke-config.js';
import { SmokeRun } from '../../src/smoke/smoke-run.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { MailWorker } from '../support/worker-mail.js';

useTestEnvironment();

/** Speaks the two endpoints of Mailpit the smoke test uses, over what the in-memory mailer of the worker received. */
function fakeMailpit(mail: MailWorker): Promise<Server> {
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      // The smoke test waits for its e-mail: let the worker deliver before answering, like the real worker does by itself.
      await mail.deliver({ retries: true });
      response.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/search') {
        const address = (url.searchParams.get('query') ?? '').replace(/^to:/, '');
        const messages = mail.mailer.to(address).map((_, index) => ({ ID: `${address}|${index}` }));
        response.end(JSON.stringify({ messages: messages.slice(-1) }));
        return;
      }
      const [address, index] = decodeURIComponent(url.pathname.replace('/api/v1/message/', '')).split('|');
      response.end(JSON.stringify({ Text: mail.mailer.to(address!)[Number(index)]?.text ?? '' }));
    })();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

describe('the smoke test of a deployment (deploy/verify.sh)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let mail: MailWorker;
  let mailpit: Server;
  let config: SmokeConfig;
  const bucket = inject('storage');
  const s3 = new S3Client({
    endpoint: bucket.endpoint,
    region: bucket.region,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: bucket.accessKeyId, secretAccessKey: bucket.secretAccessKey },
  });
  const keysUnder = async (prefix: string) => ((await s3.send(new ListObjectsV2Command({ Bucket: bucket.bucket, Prefix: prefix }))).Contents ?? []).map((entry) => entry.Key);

  beforeAll(async () => {
    db = connectTestDatabase();
    // Rate limits stay on: the smoke test must work within the limits of a real deployment.
    ({ app } = await createTestApp({ rateLimiting: true }));
    await (app as NestExpressApplication).listen(0, '127.0.0.1');
    mail = await MailWorker.start();
    mailpit = await fakeMailpit(mail);
    config = loadSmokeConfig({
      BASE_URL: `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}`,
      MAILPIT_URL: `http://127.0.0.1:${(mailpit.address() as AddressInfo).port}`,
      SMOKE_DATABASE_URL: inject('platformUrl'),
      STORAGE_ENDPOINT: bucket.endpoint,
      STORAGE_REGION: bucket.region,
      STORAGE_BUCKET: bucket.bucket,
      STORAGE_ACCESS_KEY_ID: bucket.accessKeyId,
      STORAGE_SECRET_ACCESS_KEY: bucket.secretAccessKey,
      STORAGE_FORCE_PATH_STYLE: 'true',
    });
  });
  afterAll(async () => {
    mailpit.close();
    await mail.close();
    await app.close();
    await db.close();
  });

  it('passes every step against a running API and removes everything it created', async () => {
    const run = new SmokeRun(config);
    await run.health();
    await run.platformAdmin();
    await run.organization();
    await run.ownerInvitation();
    await run.workflow();
    await run.upload();
    await run.ticketFlow();
    await run.download();
    await run.report();

    const tenantId = run.state.tenantId!;
    expect((await keysUnder(`tenants/${tenantId}/`)).length).toBe(1);
    expect((await db.owner.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId])).rowCount).toBe(1);

    const removed = await cleanUp(config, run.state);

    expect(removed).toEqual({ tenants: 1, objects: 1 });
    expect(await keysUnder(`tenants/${tenantId}/`)).toEqual([]);
    expect((await db.owner.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId])).rowCount).toBe(0);
    expect((await db.owner.query(`SELECT 1 FROM users WHERE email LIKE 'smoke-%@smoke.invalid'`)).rowCount).toBe(0);
    expect((await db.owner.query('SELECT 1 FROM platform_admins WHERE user_id = $1', [run.state.adminUserId])).rowCount).toBe(0);
  });

  it('cleans up after a run that died halfway, and never touches a tenant that is not a smoke tenant', async () => {
    const run = new SmokeRun(config);
    await run.health();
    await run.platformAdmin();
    await run.organization();
    const stale = run.state.tenantId!;
    // An organization that only looks like smoke: right slug, other name. It must survive.
    const bystander = (await db.owner.query<{ id: string }>(
      `INSERT INTO tenants (slug, name, plan_id, country_code, time_zone, created_at) SELECT 'smoke-0badc0de', 'A real customer', id, 'CO', 'America/Bogota', now() - interval '3 hours' FROM plans WHERE code = 'professional' RETURNING id`,
    )).rows[0]!.id;
    await db.owner.query(`UPDATE tenants SET created_at = now() - interval '3 hours' WHERE id = $1`, [stale]);

    // A new run's cleanup, which knows nothing of the first run's state, removes the stale smoke tenant.
    const removed = await cleanUp(config, {});

    expect(removed.tenants).toBe(1);
    expect((await db.owner.query('SELECT 1 FROM tenants WHERE id = $1', [stale])).rowCount).toBe(0);
    expect((await db.owner.query('SELECT 1 FROM tenants WHERE id = $1', [bystander])).rowCount).toBe(1);
    await db.owner.query('DELETE FROM tenants WHERE id = $1', [bystander]);
  });
});

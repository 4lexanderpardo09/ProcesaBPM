import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerTransactionRunner } from '../../src/infrastructure/database/worker-transaction-runner.js';
import type { MailMessage } from '../../src/infrastructure/mail/mailer.js';
import { OutboxClaimsRepository } from '../../src/infrastructure/outbox/outbox-claims.repository.js';
import type { ClaimedEvent } from '../../src/infrastructure/outbox/outbox-handler.js';
import { bearer } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { MailWorker } from '../support/worker-mail.js';

useTestEnvironment();

interface StaleOutcome {
  current: boolean;
  completed: boolean;
  failed: boolean;
}

/**
 * The race that a reused attempt number allowed: a worker stalls past its lease, another one fails the event for good,
 * an administrator retries it from the console (attempts back to 0) and a third worker claims it as attempt 1 again.
 * The stalled worker also holds "attempt 1", so only the claim token tells them apart.
 */
describe('outbox claim fencing (e-mail retried from the platform console)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let adminToken: string;
  let mail: MailWorker;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    adminToken = await signInPlatform(app, db, await seedPlatformAdmin(db));
    mail = await MailWorker.start();
  });
  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  const eventRow = async (id: string) =>
    (await db.owner.query<{ status: string; attempts: number; claim_token: string | null }>('SELECT status, attempts, claim_token FROM platform_outbox_events WHERE id = $1', [id])).rows[0]!;
  // available_at has millisecond precision: a second in the past makes the event due for the next claim, deterministically.
  // Test files run side by side against one database and every worker claims the due events of every tenant, so an event
  // is made due only right before this file's worker runs.
  const makeDue = (id: string) => db.owner.query(`UPDATE platform_outbox_events SET available_at = now() - interval '1 second' WHERE id = $1`, [id]);

  /**
   * Runs this worker until the event leaves PENDING/PROCESSING. A round claims the oldest due events first and at most a
   * batch of them: under the full suite, events that other files queued while this one held the outbox can fill the
   * first rounds, so one round is not enough to reach this event.
   */
  const dispatchUntilSettled = async (id: string) => {
    for (let round = 0; round < 50 && ['PENDING', 'PROCESSING'].includes((await eventRow(id)).status); round += 1) await mail.dispatcher.runOnce();
  };

  /** What a worker that claimed the event long ago still tries to do with its claim. */
  async function actAsStaleHolder(stale: ClaimedEvent<unknown>): Promise<StaleOutcome> {
    const runner = mail.module.get(WorkerTransactionRunner);
    const claims = mail.module.get(OutboxClaimsRepository);
    const current = await runner.withoutTenant((tx) => claims.isCurrent(tx, 'platform', stale));
    const completed = await runner.withoutTenant((tx) => claims.complete(tx, 'platform', stale));
    const failed = await runner.withoutTenant((tx) => claims.fail(tx, 'platform', stale, 'Error', null));
    return { current, completed, failed };
  }

  it('is sent exactly once, and the stalled holder can neither complete nor fail it', async () => {
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    // Test files run side by side against one database and every worker claims the due events of every tenant: nobody
    // else may dispatch while this scenario moves the event through its states.
    await mail.exclusively(async () => {
      const { rows } = await db.runtime.query<{ id: string }>(`SELECT enqueue_platform_event('email.password_reset', jsonb_build_object('userId', $1::text)) AS id`, [user.userId]);
      const id = rows[0]!.id;

      // W1 claimed the event as attempt 1 and stalled past its lease.
      const held = await db.owner.query<{ claim_token: string }>(
        `UPDATE platform_outbox_events SET status = 'PROCESSING', attempts = 1, claim_token = gen_random_uuid(), available_at = now() + interval '1 hour'
         WHERE id = $1 RETURNING claim_token::text`,
        [id],
      );
      const stale: ClaimedEvent<unknown> = { id, tenantId: null, type: 'email.password_reset', attempt: 1, claimToken: held.rows[0]!.claim_token, createdAt: new Date(), payload: {} };

      // W2 reclaims it (attempt 2) and the provider refuses the message for good. The lease expires only now: until then
      // the workers that other test files run against the same database cannot claim the event.
      await makeDue(id);
      mail.mailer.failNextTo(user.email, Object.assign(new Error('550 mailbox unavailable'), { permanent: true }));
      await dispatchUntilSettled(id);
      expect(await eventRow(id)).toMatchObject({ status: 'FAILED', attempts: 2, claim_token: null });
      expect(mail.mailer.to(user.email)).toHaveLength(0);

      await request(app.getHttpServer()).post(`/platform/operations/outbox-events/platform/${id}/retry`).set(bearer(adminToken)).expect(204);
      expect(await eventRow(id)).toMatchObject({ status: 'PENDING', attempts: 0 });
      await makeDue(id);

      // W3 claims it as attempt 1 again; while it is sending, W1 wakes up.
      let staleOutcome: StaleOutcome | undefined;
      const send = mail.mailer.send.bind(mail.mailer);
      mail.mailer.send = async (message: MailMessage) => {
        if (message.to === user.email && staleOutcome === undefined) staleOutcome = await actAsStaleHolder(stale);
        return send(message);
      };
      try {
        await dispatchUntilSettled(id);
      } finally {
        mail.mailer.send = send;
      }

      expect(staleOutcome).toEqual({ current: false, completed: false, failed: false });
      expect(await eventRow(id)).toMatchObject({ status: 'DONE', attempts: 1, claim_token: null });
    });
    await mail.deliver({ retries: true });
    expect(mail.mailer.to(user.email)).toHaveLength(1);
  });
});

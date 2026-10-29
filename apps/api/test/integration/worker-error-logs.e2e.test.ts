import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JsonLogger, type LogWriter } from '../../src/common/logging/json-logger.js';
import { seedUser } from '../support/auth-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { MailWorker } from '../support/worker-mail.js';

// The suite logs only errors; this file reads the warnings of a failed event.
useTestEnvironment({ LOG_LEVEL: 'warn' });

/** The worker's log as it is written (one JSON object per line), for the events of one outbox event. */
function captureLog(mail: MailWorker): { linesAbout: (eventId: string) => Array<Record<string, unknown>> } {
  const logger = mail.module.get(JsonLogger) as unknown as { write: LogWriter };
  const lines: string[] = [];
  const original = logger.write;
  vi.spyOn(logger, 'write').mockImplementation((line: string) => {
    lines.push(line);
    original(line);
  });
  return { linesAbout: (eventId) => lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.eventId === eventId) };
}

describe('worker error logs: what failed, its code and its cause, never [object Object]', () => {
  let db: TestDatabase;
  let mail: MailWorker;

  beforeAll(async () => {
    db = connectTestDatabase();
    mail = await MailWorker.start();
  });
  afterAll(async () => {
    await mail.close();
    await db.close();
  });

  it('logs a failed e-mail with the provider message (addresses hidden), its code and the cause, and stores only the kind', async () => {
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    const log = captureLog(mail);
    await mail.exclusively(async () => {
      const { rows } = await db.runtime.query<{ id: string }>(`SELECT enqueue_platform_event('email.password_reset', jsonb_build_object('userId', $1::text)) AS id`, [user.userId]);
      const id = rows[0]!.id;
      const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      mail.mailer.failNextTo(user.email, Object.assign(new Error(`450 4.2.0 <${user.email}> temporarily rejected`, { cause }), { code: 'EENVELOPE' }));
      for (let round = 0; round < 50 && log.linesAbout(id).length === 0; round += 1) await mail.dispatcher.runOnce();

      const [entry] = log.linesAbout(id);
      expect(entry).toMatchObject({
        level: 'warn',
        message: 'Outbox event failed and will be retried',
        context: 'OutboxDispatcher',
        error: { name: 'Error', message: '450 4.2.0 <<email>> temporarily rejected', code: 'EENVELOPE', cause: { message: 'socket hang up', code: 'ECONNRESET' } },
      });
      expect(JSON.stringify(log.linesAbout(id))).not.toContain(user.email);
      expect(JSON.stringify(log.linesAbout(id))).not.toContain('[object Object]');
      const stored = await db.owner.query<{ last_error: string }>('SELECT last_error FROM platform_outbox_events WHERE id = $1', [id]);
      expect(stored.rows[0]!.last_error).toBe('Error:EENVELOPE');
    });
  });
});

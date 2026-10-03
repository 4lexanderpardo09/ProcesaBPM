import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BackgroundTasks } from '../../src/common/background/background-tasks.js';
import type { MailMessage } from '../../src/infrastructure/mail/mailer.js';
import type { SecurityNoticeKind } from '../../src/infrastructure/outbox/platform-event-types.js';
import { base32Decode } from '../../src/modules/auth/domain/totp.js';
import { authMailEs } from '../../src/modules/auth/i18n/es.js';
import { bearer, signIn } from '../support/auth-helpers.js';
import { inviteUser, seedUser, type TestUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { currentCode, enableMfa, logInWithMfa, rewindReplayGuard } from '../support/mfa-fixtures.js';
import { grantEverything } from '../support/permission-fixtures.js';
import { seedPlatformAdmin } from '../support/platform-fixtures.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { MailWorker, tokenOf } from '../support/worker-mail.js';

useTestEnvironment();

const NEW_PASSWORD = 'a brand new passphrase 2026';
const WRONG_PASSWORD = 'definitely not the password';
const subjectOf = (kind: SecurityNoticeKind) => authMailEs.securityNotice.subject[kind];

describe('security e-mails', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenant: SeededTenant;
  let mail: MailWorker;

  const http = () => request(app.getHttpServer());
  const login = (email: string, password: string) => http().post('/auth/login').send({ email, password });

  /** Every notice sent to the address so far, after the worker delivered what is due. */
  async function noticesTo(email: string): Promise<MailMessage[]> {
    await app.get(BackgroundTasks).whenIdle();
    await mail.deliver({ retries: true });
    const subjects = new Set(Object.values(authMailEs.securityNotice.subject));
    return mail.mailer.to(email).filter((message) => subjects.has(message.subject as never));
  }
  async function expectOnlyNotice(email: string, kind: SecurityNoticeKind): Promise<MailMessage> {
    const notices = await noticesTo(email);
    expect(notices.map((message) => message.subject)).toEqual([subjectOf(kind)]);
    return notices[0]!;
  }
  /** The platform outbox is out of the API's reach: read as the schema owner. */
  async function storedNotices(userId: string): Promise<Array<Record<string, unknown>>> {
    const { rows } = await db.owner.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM platform_outbox_events WHERE type = 'email.security_notice' AND payload ->> 'userId' = $1 ORDER BY created_at, id`,
      [userId],
    );
    return rows.map((row) => row.payload);
  }
  const expireLock = (userId: string) => db.owner.query(`UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`, [userId]);

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    await grantEverything(db, tenant);
    ({ app } = await createTestApp());
    mail = await MailWorker.start();
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  describe('password', () => {
    it('a change mails PASSWORD_CHANGED once, informative and without any link with a secret', async () => {
      const user = await seedUser(db, tenant);
      const session = await signIn(app, user.email, tenant.tenantId);
      await http().post('/auth/password').set(bearer(session.accessToken)).send({ currentPassword: user.password, newPassword: NEW_PASSWORD }).expect(204);
      const notice = await expectOnlyNotice(user.email, 'PASSWORD_CHANGED');
      expect(notice.text).toContain('/forgot-password');
      expect(notice.text).not.toContain('token');
      expect(await storedNotices(user.userId)).toEqual([{ userId: user.userId, kind: 'PASSWORD_CHANGED' }]);
    });

    it('a reset mails PASSWORD_RESET; the reset link itself is a separate mail', async () => {
      const user = await seedUser(db, tenant);
      await http().post('/auth/password-reset/request').send({ email: user.email }).expect(202);
      await app.get(BackgroundTasks).whenIdle();
      await mail.deliver({ retries: true });
      const token = tokenOf(mail.lastTo(user.email)!);
      expect(await noticesTo(user.email)).toEqual([]);

      await http().post('/auth/password-reset/confirm').send({ token, newPassword: NEW_PASSWORD }).expect(204);
      const notice = await expectOnlyNotice(user.email, 'PASSWORD_RESET');
      expect(notice.text).toContain('restableció');
      expect(notice.text).not.toContain(token);
    });

    it('accepting an invitation that sets the first password sends none', async () => {
      const email = `invited-${Math.random().toString(36).slice(2, 10)}@example.com`;
      const invited = await inviteUser(db, tenant, email);
      await http().post('/auth/invitations/accept').send({ token: invited.token, password: NEW_PASSWORD }).expect(200);
      expect(await noticesTo(email)).toEqual([]);
      expect(await storedNotices(invited.userId)).toEqual([]);
    });

    it('a failed change (wrong current password) sends none', async () => {
      const user = await seedUser(db, tenant);
      const session = await signIn(app, user.email, tenant.tenantId);
      await http().post('/auth/password').set(bearer(session.accessToken)).send({ currentPassword: WRONG_PASSWORD, newPassword: NEW_PASSWORD }).expect(401);
      expect(await noticesTo(user.email)).toEqual([]);
    });
  });

  describe('lockout', () => {
    async function lockedOut(user: TestUser, attempts: number): Promise<void> {
      for (let attempt = 0; attempt < attempts; attempt += 1) await login(user.email, WRONG_PASSWORD).expect(401);
    }

    it('five wrong passwords mail one ACCOUNT_LOCKED; locking again within 24 hours mails nothing more', async () => {
      const user = await seedUser(db, tenant);
      await lockedOut(user, 4);
      expect(await noticesTo(user.email)).toEqual([]);
      await lockedOut(user, 1);
      await expectOnlyNotice(user.email, 'ACCOUNT_LOCKED');

      await lockedOut(user, 3); // refused while locked: no claim, no notice
      for (let round = 0; round < 10; round += 1) {
        await expireLock(user.userId);
        await lockedOut(user, 1); // each one locks the account again
      }
      await expectOnlyNotice(user.email, 'ACCOUNT_LOCKED');
      expect(await storedNotices(user.userId)).toEqual([{ userId: user.userId, kind: 'ACCOUNT_LOCKED' }]);
    });

    it('five wrong current passwords on a password change (a stolen access token) mail one ACCOUNT_LOCKED', async () => {
      const user = await seedUser(db, tenant);
      const session = await signIn(app, user.email, tenant.tenantId);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await http().post('/auth/password').set(bearer(session.accessToken)).send({ currentPassword: WRONG_PASSWORD, newPassword: NEW_PASSWORD }).expect(401);
      }
      await expectOnlyNotice(user.email, 'ACCOUNT_LOCKED');
    });

    it('the right password on the fifth attempt sends none', async () => {
      const user = await seedUser(db, tenant);
      await lockedOut(user, 4);
      await login(user.email, user.password).expect(200);
      expect(await noticesTo(user.email)).toEqual([]);
    });

    it('an unknown e-mail queues nothing', async () => {
      const email = `nobody-${Math.random().toString(36).slice(2, 10)}@example.com`;
      for (let attempt = 0; attempt < 6; attempt += 1) await login(email, WRONG_PASSWORD).expect(401);
      expect(await noticesTo(email)).toEqual([]);
    });

    it('five wrong second-factor codes mail one MFA_LOCKED', async () => {
      const user = await seedUser(db, tenant);
      await enableMfa(db, user.userId);
      const challenge = (await login(user.email, user.password).expect(200)).body.challengeToken as string;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await http().post('/auth/login/mfa').set(bearer(challenge)).send({ code: '000000' }).expect(401);
      }
      await expectOnlyNotice(user.email, 'MFA_LOCKED');
    });
  });

  describe('second factor', () => {
    it('enabling, regenerating the backup codes and disabling each mail one notice', async () => {
      const user = await seedUser(db, tenant);
      const session = await signIn(app, user.email, tenant.tenantId);
      const call = (path: string, body?: object) => http().post(path).set(bearer(session.accessToken)).send(body);

      const secret = base32Decode((await call('/auth/mfa/enrollment').expect(200)).body.secret as string);
      await call('/auth/mfa/enrollment/confirm', { code: currentCode(secret), currentPassword: user.password }).expect(200);
      await expectOnlyNotice(user.email, 'MFA_ENABLED');

      await rewindReplayGuard(db, user.userId);
      await call('/auth/mfa/backup-codes', { code: currentCode(secret) }).expect(200);
      await rewindReplayGuard(db, user.userId);
      await call('/auth/mfa/disable', { password: user.password, code: currentCode(secret) }).expect(204);

      // The worker sends a batch in parallel: the order of arrival is not the order of the actions.
      const subjects = (await noticesTo(user.email)).map((message) => message.subject).sort();
      expect(subjects).toEqual([subjectOf('MFA_ENABLED'), subjectOf('MFA_BACKUP_CODES_REGENERATED'), subjectOf('MFA_DISABLED')].sort());
      expect(await storedNotices(user.userId)).toEqual(
        (['MFA_ENABLED', 'MFA_BACKUP_CODES_REGENERATED', 'MFA_DISABLED'] as const).map((kind) => ({ userId: user.userId, kind })),
      );
    });

    it('the enrollment forced at sign-in mails MFA_ENABLED', async () => {
      const admin = await seedPlatformAdmin(db);
      await db.owner.query('DELETE FROM user_mfa_backup_codes WHERE user_id = $1', [admin.userId]);
      await db.owner.query('UPDATE users SET mfa_enabled = false, mfa_enabled_at = NULL, mfa_secret_encrypted = NULL WHERE id = $1', [admin.userId]);
      const login1 = await login(admin.email, admin.password).expect(200);
      expect(login1.body.step).toBe('MFA_ENROLLMENT_REQUIRED');
      const challenge = login1.body.challengeToken as string;
      const secret = base32Decode((await http().post('/auth/login/mfa/enrollment').set(bearer(challenge)).expect(200)).body.secret as string);
      await http().post('/auth/login/mfa/enrollment/confirm').set(bearer(challenge)).send({ code: currentCode(secret) }).expect(200);
      await expectOnlyNotice(admin.email, 'MFA_ENABLED');
    });
  });

  describe('platform sign-in', () => {
    it('mails the administrator with the IP and the browser of the new session', async () => {
      const admin = await seedPlatformAdmin(db);
      const selection = await logInWithMfa(app, db, admin, admin.mfa);
      await http().post('/auth/platform/select').set('authorization', `Bearer ${selection}`).set('user-agent', 'SecurityNoticeTest/1.0').expect(200);

      const notice = await expectOnlyNotice(admin.email, 'PLATFORM_ADMIN_SIGN_IN');
      const { rows } = await db.owner.query<{ id: string; ip_address: string }>(
        'SELECT id, ip_address FROM refresh_sessions WHERE user_id = $1 AND active_tenant_id IS NULL',
        [admin.userId],
      );
      expect(rows).toHaveLength(1);
      expect(notice.text).toContain(rows[0]!.ip_address);
      expect(notice.text).toContain('SecurityNoticeTest/1.0');
      expect(await storedNotices(admin.userId)).toEqual([{ userId: admin.userId, kind: 'PLATFORM_ADMIN_SIGN_IN', sessionId: rows[0]!.id }]);
    });
  });

  describe('recipients', () => {
    it('a disabled account gets nothing, and the event still completes', async () => {
      const user = await seedUser(db, tenant);
      const session = await signIn(app, user.email, tenant.tenantId);
      await http().post('/auth/password').set(bearer(session.accessToken)).send({ currentPassword: user.password, newPassword: NEW_PASSWORD }).expect(204);
      await db.owner.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [user.userId]);
      expect(await noticesTo(user.email)).toEqual([]);
      const { rows } = await db.owner.query<{ status: string }>(
        `SELECT status::text AS status FROM platform_outbox_events WHERE type = 'email.security_notice' AND payload ->> 'userId' = $1`,
        [user.userId],
      );
      expect(rows).toEqual([{ status: 'DONE' }]);
    });
  });
});

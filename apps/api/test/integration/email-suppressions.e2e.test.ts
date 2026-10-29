import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SnsClient } from '../../src/modules/email-suppressions/application/sns-client.js';
import { bearer, signIn } from '../support/auth-helpers.js';
import { seedUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedPlatformAdmin, signInPlatform } from '../support/platform-fixtures.js';
import { snsTestSigner } from '../support/sns-test-signer.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { MailWorker } from '../support/worker-mail.js';

const TOPIC = 'arn:aws:sns:us-east-1:123456789012:procesabpm-ses-events';
useTestEnvironment({ SES_SNS_TOPIC_ARN: TOPIC });

const signer = snsTestSigner(TOPIC);
const bounceOf = (email: string, bounceType = 'Permanent') =>
  JSON.stringify({ notificationType: 'Bounce', bounce: { bounceType, bounceSubType: 'General', feedbackId: `fb-${Math.random()}`, bouncedRecipients: [{ emailAddress: email }] } });
const complaintOf = (email: string) => JSON.stringify({ notificationType: 'Complaint', complaint: { complaintFeedbackType: 'abuse', feedbackId: `fb-${Math.random()}`, complainedRecipients: [{ emailAddress: email }] } });

describe('SES bounces and complaints through SNS: recorded, honoured by the worker, managed from the console (§8.34)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let mail: MailWorker;
  let platformToken: string;
  let confirmed: string[];

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/public/email-events/ses')
      .set('content-type', 'text/plain; charset=UTF-8')
      .send(typeof body === 'string' ? body : JSON.stringify(body));
  const suppression = async (email: string) =>
    (await db.owner.query<{ reason: string; detail: string | null; events: number }>('SELECT reason, detail, events FROM email_suppressions WHERE email = lower($1)', [email])).rows[0];
  const address = () => `Bounced-${Math.random().toString(36).slice(2, 10)}@acme.co`;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    const sns = app.get(SnsClient);
    confirmed = [];
    vi.spyOn(sns, 'certificate').mockImplementation(async (url) => {
      if (url !== signer.certUrl) throw new Error(`unexpected certificate ${url}`);
      return signer.publicKeyPem;
    });
    vi.spyOn(sns, 'confirmSubscription').mockImplementation(async (url) => void confirmed.push(url));
    platformToken = await signInPlatform(app, db, await seedPlatformAdmin(db));
    mail = await MailWorker.start();
  });
  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  it('confirms the subscription of the configured topic, at the address SNS gave', async () => {
    const subscribeUrl = 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc';
    await post(signer.sign({ Type: 'SubscriptionConfirmation', Message: 'You have chosen to subscribe…', SubscribeURL: subscribeUrl, Token: 'abc' })).expect(204);
    expect(confirmed).toEqual([subscribeUrl]);
  });

  it('records a permanent bounce and a complaint, once per notification, and ignores a transient bounce', async () => {
    const bounced = address();
    const notice = signer.sign({ Type: 'Notification', Message: bounceOf(bounced) }, '1');
    await post(notice).expect(204);
    await post(notice).expect(204);
    expect(await suppression(bounced)).toEqual({ reason: 'BOUNCE', detail: 'Permanent/General', events: 1 });

    const complained = address();
    await post(signer.sign({ Type: 'Notification', Message: complaintOf(complained) })).expect(204);
    expect(await suppression(complained)).toMatchObject({ reason: 'COMPLAINT', detail: 'abuse' });

    const busy = address();
    await post(signer.sign({ Type: 'Notification', Message: bounceOf(busy, 'Transient') })).expect(204);
    expect(await suppression(busy)).toBeUndefined();
  });

  it('believes nothing that does not prove it comes from the topic: other topic, bad signature, foreign certificate, stale, not SNS', async () => {
    const email = address();
    const good = signer.sign({ Type: 'Notification', Message: bounceOf(email) });
    await post({ ...good, Message: bounceOf(address()) }).expect(403);
    await post(snsTestSigner('arn:aws:sns:us-east-1:123456789012:someone-else').sign({ Type: 'Notification', Message: bounceOf(email) })).expect(403);
    await post({ ...good, SigningCertURL: 'https://evil.example/cert.pem' }).expect(403);
    await post(signer.sign({ Type: 'Notification', Message: bounceOf(email), Timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })).expect(403);
    await post(signer.sign({ Type: 'SubscriptionConfirmation', Message: 'x', SubscribeURL: 'https://evil.example/confirm', Token: 't' })).expect(403);
    await post('not json').expect(400);
    await post({ hello: 'world' }).expect(400);
    expect(await suppression(email)).toBeUndefined();
  });

  it('the worker does not write to a suppressed address, and does again once the console removes it', async () => {
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    await post(signer.sign({ Type: 'Notification', Message: bounceOf(user.email) })).expect(204);

    await request(app.getHttpServer()).post('/auth/password-reset/request').send({ email: user.email }).expect(202);
    await mail.deliver();
    expect(mail.mailer.to(user.email)).toEqual([]);
    // The reset e-mail was queued and handled (not retried, not failed): only the send was skipped.
    const handled = await db.owner.query<{ status: string }>(`SELECT status FROM platform_outbox_events WHERE type = 'email.password_reset' AND payload ->> 'userId' = $1`, [user.userId]);
    expect(handled.rows.map((row) => row.status)).toEqual(['DONE']);

    const listed = await request(app.getHttpServer()).get('/platform/email-suppressions').query({ search: user.email.split('@')[0], reason: 'BOUNCE' }).set(bearer(platformToken)).expect(200);
    expect(listed.body).toMatchObject({ total: 1, items: [{ email: user.email.toLowerCase(), reason: 'BOUNCE', events: 1 }] });
    const id = listed.body.items[0].id as string;
    await request(app.getHttpServer()).delete(`/platform/email-suppressions/${id}`).set(bearer(platformToken)).expect(204);
    await request(app.getHttpServer()).delete(`/platform/email-suppressions/${id}`).set(bearer(platformToken)).expect(404);
    const audit = await db.owner.query<{ data: unknown }>(`SELECT data FROM platform_audit_logs WHERE action = 'email_suppression.removed' AND data ->> 'id' = $1`, [id]);
    expect(audit.rows).toEqual([{ data: { id, reason: 'BOUNCE', events: 1 } }]);

    // A second reset request right away is held back by its cooldown: the event is queued as the API would.
    await db.runtime.query(`SELECT enqueue_platform_event('email.password_reset', jsonb_build_object('userId', $1::text))`, [user.userId]);
    await mail.deliver();
    expect(mail.mailer.to(user.email)).toHaveLength(1);
  });

  it('is the platform console’s only: a member of an organization cannot list or remove suppressions', async () => {
    const tenant = await seedTenant(db.platform);
    const user = await seedUser(db, tenant);
    const { accessToken } = await signIn(app, user.email, tenant.tenantId);
    await request(app.getHttpServer()).get('/platform/email-suppressions').set(bearer(accessToken)).expect(403);
    await request(app.getHttpServer()).delete('/platform/email-suppressions/00000000-0000-7000-8000-000000000000').set(bearer(accessToken)).expect(403);
  });
});

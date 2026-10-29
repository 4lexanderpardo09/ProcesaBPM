import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, simpleFlow, TicketWorld } from '../support/ticket-world.js';
import { MailWorker } from '../support/worker-mail.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

interface PolicyBody {
  type: string;
  policy: string;
  chosen: boolean;
}

describe('the organization’s e-mail policy of notifications (§8.35)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let mail: MailWorker;
  let world: TicketWorld;
  let requester: Member;
  let assignee: Member;
  let flow: PublishedFlow;

  const emailOf = async (member: Member) => (await member.client.get('/auth/me').expect(200)).body.user.email as string;
  const setPolicy = (type: string, policy: string, on = world) => on.admin.put(`/settings/notification-emails/${type}`, { policy });
  const create = async () => (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Policy', values: {} }).expect(201)).body as { id: string };
  const subjectsTo = async (member: Member) => mail.mailer.to(await emailOf(member)).map((message) => message.subject);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    mail = await MailWorker.start();
    world = await TicketWorld.create(db, app);
    requester = await world.member([grant('create'), grant('read_created')]);
    assignee = await world.member([grant('read_assigned'), grant('transition')]);
    flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(assignee)] }));
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  it('lists every ticket type with its built-in default until the administrator chooses, and records each change in the audit trail', async () => {
    const listed = (await world.admin.get('/settings/notification-emails').expect(200)).body as PolicyBody[];
    expect(listed).toHaveLength(12);
    expect(listed.map((row) => row.type)).not.toContain('STORAGE_QUOTA');
    expect(listed.filter((row) => row.policy === 'DEFAULT_ON').map((row) => row.type)).toEqual(['TICKET_ASSIGNED', 'SYSTEM']);
    expect(listed.every((row) => !row.chosen)).toBe(true);

    expect((await setPolicy('TICKET_REOPENED', 'OFF').expect(200)).body).toEqual({ type: 'TICKET_REOPENED', policy: 'OFF', chosen: true });
    const audit = await db.owner.query<{ before: unknown; after: unknown }>(`SELECT before, after FROM audit_logs WHERE tenant_id = $1 AND action = 'tenant.notification_email_policy_updated'`, [world.tenant.tenantId]);
    expect(audit.rows).toEqual([{ before: { type: 'TICKET_REOPENED', policy: 'DEFAULT_OFF' }, after: { type: 'TICKET_REOPENED', policy: 'OFF' } }]);
    await setPolicy('TICKET_REOPENED', 'DEFAULT_OFF').expect(200);

    await setPolicy('STORAGE_QUOTA', 'OFF').expect(400);
    await setPolicy('TICKET_CLOSED', 'SOMETIMES').expect(400);
  });

  it('is the administrators’ only: a member without the settings permission can neither read nor change it', async () => {
    await requester.client.get('/settings/notification-emails').expect(403);
    await requester.client.put('/settings/notification-emails/TICKET_CREATED', { policy: 'OFF' }).expect(403);
  });

  it('DEFAULT_ON mails whoever never chose, and not who turned it off', async () => {
    const declined = await world.member([grant('create'), grant('read_created')]);
    await declined.client.put('/notifications/preferences/TICKET_CREATED', { inApp: true, email: false }).expect(200);
    await setPolicy('TICKET_CREATED', 'DEFAULT_ON').expect(200);
    mail.mailer.clear();
    await create();
    await declined.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Mine', values: {} }).expect(201);
    await mail.deliver();
    expect((await subjectsTo(requester)).filter((subject) => subject.startsWith('Se abrió el ticket #'))).toHaveLength(1);
    expect(await subjectsTo(declined)).toEqual([]);
    await setPolicy('TICKET_CREATED', 'DEFAULT_OFF').expect(200);
  });

  it('OFF mails nobody, not even who asked for it, keeps the in-app notice, and shows the person why', async () => {
    await assignee.client.put('/notifications/preferences/TICKET_ASSIGNED', { inApp: true, email: true }).expect(200);
    await setPolicy('TICKET_ASSIGNED', 'OFF').expect(200);
    mail.mailer.clear();
    const ticket = await create();
    await mail.deliver();
    expect(await subjectsTo(assignee)).toEqual([]);
    const notices = (await assignee.client.get('/notifications?pageSize=100').expect(200)).body.items as Array<{ ticketId: string; type: string }>;
    expect(notices.filter((notice) => notice.ticketId === ticket.id).map((notice) => notice.type)).toEqual(['TICKET_ASSIGNED']);

    const preferences = (await assignee.client.get('/notifications/preferences').expect(200)).body as Array<{ type: string; email: boolean; emailLocked: boolean }>;
    expect(preferences.find((row) => row.type === 'TICKET_ASSIGNED')).toEqual({ type: 'TICKET_ASSIGNED', inApp: true, email: false, emailLocked: true });
    expect((await assignee.client.put('/notifications/preferences/TICKET_ASSIGNED', { inApp: true, email: true }).expect(200)).body).toEqual({ type: 'TICKET_ASSIGNED', inApp: true, email: false, emailLocked: true });

    // Turned back on, the person's own choice counts again.
    await setPolicy('TICKET_ASSIGNED', 'DEFAULT_OFF').expect(200);
    await create();
    await mail.deliver();
    expect(await subjectsTo(assignee)).toHaveLength(1);
  });

  it('an e-mail already queued is not sent once the type is turned off', async () => {
    const mailbox = await emailOf(assignee);
    mail.mailer.clear();
    mail.mailer.failNextTo(mailbox, new Error('smtp down'));
    await create();
    await mail.deliver();
    expect(mail.mailer.to(mailbox)).toEqual([]);
    await setPolicy('TICKET_ASSIGNED', 'OFF').expect(200);
    await db.owner.query(`UPDATE outbox_events SET available_at = now() WHERE tenant_id = $1 AND type = 'notification.email' AND status = 'PENDING'`, [world.tenant.tenantId]);
    await mail.deliver();
    expect(mail.mailer.to(mailbox)).toEqual([]);
    const pending = await db.owner.query(`SELECT 1 FROM outbox_events WHERE tenant_id = $1 AND type = 'notification.email' AND status = 'PENDING'`, [world.tenant.tenantId]);
    expect(pending.rowCount).toBe(0);
    await setPolicy('TICKET_ASSIGNED', 'DEFAULT_ON').expect(200);
  });

  it('one organization’s policy never touches another’s', async () => {
    const other = await TicketWorld.create(db, app);
    await setPolicy('TICKET_ASSIGNED', 'OFF', other).expect(200);
    expect(((await other.admin.get('/settings/notification-emails').expect(200)).body as PolicyBody[]).find((row) => row.type === 'TICKET_ASSIGNED')).toMatchObject({ policy: 'OFF', chosen: true });
    const mine = ((await world.admin.get('/settings/notification-emails').expect(200)).body as PolicyBody[]).find((row) => row.type === 'TICKET_ASSIGNED');
    expect(mine).toEqual({ type: 'TICKET_ASSIGNED', policy: 'DEFAULT_ON', chosen: true });

    mail.mailer.clear();
    await create();
    await mail.deliver();
    expect(await subjectsTo(assignee)).toHaveLength(1);
  });
});

import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SlaOverdueJob } from '../../src/modules/sla/application/sla-overdue.job.js';
import { SlaWarningJob } from '../../src/modules/sla/application/sla-warning.job.js';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, simpleFlow, TicketWorld, unique } from '../support/ticket-world.js';
import { MailWorker } from '../support/worker-mail.js';
import { expectStatus } from '../support/supertest-diagnostics.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

interface NotificationBody {
  id: string;
  type: string;
  title: string;
  body: string;
  ticketId: string | null;
  readAt: string | null;
}

describe('notifications: fan-out of ticket events, e-mails, preferences and endpoints', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let mail: MailWorker;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let supervisor: Member;
  let observer: Member;
  let blindObserver: Member;
  let stranger: Member;
  let flow: PublishedFlow;

  const emailOf = async (member: Member) => (await member.client.get('/auth/me').expect(200)).body.user.email as string;
  const notificationsOf = async (member: Member, query = ''): Promise<NotificationBody[]> => (await member.client.get(`/notifications?pageSize=100${query}`).expect(200)).body.items;
  const typesOf = async (member: Member, ticketId: string) => (await notificationsOf(member)).filter((notification) => notification.ticketId === ticketId).map((notification) => notification.type).sort();
  const create = async (title = unique('Ticket'), as = requester) => (await as.client.post('/tickets', { subcategoryId: flow.subcategoryId, title, values: {} }).expect(201)).body as { id: string; openVisitId: string };
  const done = (ticket: { id: string; openVisitId: string }, as = worker) => as.client.post(`/tickets/${ticket.id}/transition`, { transitionId: flow.transition.Done!, visitId: ticket.openVisitId, values: {} }).expect(200);
  const fanOut = () => mail.deliver();

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    mail = await MailWorker.start();
    world = await TicketWorld.create(db, app);
    requester = await world.member([grant('create'), grant('read_created'), grant('comment')]);
    worker = await world.member([grant('read_assigned'), grant('transition'), grant('close'), grant('comment'), grant('open_incident')]);
    supervisor = await world.member([grant('read_all'), grant('reassign'), grant('transition')]);
    observer = await world.member([grant('read_observed')]);
    blindObserver = await world.member([grant('read_created')]);
    stranger = await world.member([grant('read_created'), grant('read_assigned')]);
    flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS', slaValue: 8, slaUnit: 'BUSINESS_HOURS' }, { candidates: [user(worker)] }));
    for (const member of [observer, blindObserver]) await world.admin.post(`/workflows/${flow.workflowId}/observers`, { participantType: 'USER', userId: member.userId }).expect(201);
  });

  afterAll(async () => {
    await mail.close();
    await app.close();
    await db.close();
  });

  describe('who is told about what', () => {
    it('creating: the assignee and the observers who can read it; not the creator, who did it, nor an observer who cannot read it', async () => {
      const ticket = await create();
      await fanOut();
      expect(await typesOf(worker, ticket.id)).toEqual(['TICKET_ASSIGNED']);
      expect(await typesOf(observer, ticket.id)).toEqual(['OBSERVER_UPDATE']);
      expect(await typesOf(requester, ticket.id)).toEqual([]);
      expect(await typesOf(blindObserver, ticket.id)).toEqual([]);
      expect(await typesOf(stranger, ticket.id)).toEqual([]);
      expect(await typesOf(supervisor, ticket.id)).toEqual([]);
    });

    it('advancing: the creator and the observers, not the person who did it', async () => {
      const ticket = await create();
      await done(ticket);
      await fanOut();
      expect(await typesOf(requester, ticket.id)).toEqual(['TICKET_CLOSED']);
      expect(await typesOf(observer, ticket.id)).toEqual(['OBSERVER_UPDATE', 'OBSERVER_UPDATE']);
      expect((await typesOf(worker, ticket.id)).filter((type) => type !== 'TICKET_ASSIGNED')).toEqual([]);
    });

    it('commenting: the other side of the conversation, not the author, and not the observers', async () => {
      const ticket = await create();
      await fanOut();
      await requester.client.post(`/tickets/${ticket.id}/comments`, { comment: 'Please hurry' }).expect(201);
      await worker.client.post(`/tickets/${ticket.id}/comments`, { comment: 'On it' }).expect(201);
      await fanOut();
      expect(await typesOf(worker, ticket.id)).toEqual(['TICKET_ASSIGNED', 'TICKET_COMMENTED']);
      expect(await typesOf(requester, ticket.id)).toEqual(['TICKET_COMMENTED']);
      expect((await typesOf(observer, ticket.id)).includes('TICKET_COMMENTED')).toBe(false);
    });

    it('taking and reassigning: the new holder is told, and whoever acted is not', async () => {
      const ticket = await create();
      await fanOut();
      const other = await world.member([grant('read_assigned'), grant('transition')]);
      const reassigned = await supervisor.client.post(`/tickets/${ticket.id}/reassign`, { toUserId: other.userId, visitId: ticket.openVisitId });
      expect([reassigned.status, reassigned.body.error?.code]).toEqual([200, undefined]);
      await fanOut();
      expect(await typesOf(other, ticket.id)).toEqual(['TICKET_ASSIGNED']);
      expect(await typesOf(supervisor, ticket.id)).toEqual([]);
    });

    it('an incident: the person it is handed to and, when resolved, whoever opened it', async () => {
      const ticket = await create();
      const helper = await world.member([grant('read_assigned'), grant('transition')]);
      const opened = (await worker.client.post(`/tickets/${ticket.id}/incidents`, { visitId: ticket.openVisitId, assignedToId: helper.userId, description: 'Blocked' }).expect(201)).body as { incidentId: string };
      await fanOut();
      expect(await typesOf(helper, ticket.id)).toEqual(['INCIDENT_OPENED']);
      await helper.client.post(`/tickets/${ticket.id}/incidents/${opened.incidentId}/resolve`, { resolution: 'Fixed' }).expect(200);
      await fanOut();
      expect((await typesOf(worker, ticket.id)).includes('INCIDENT_RESOLVED')).toBe(true);
    });

    it('an overdue SLA clock: the responsible person and the observers', async () => {
      const ticket = await create();
      await fanOut();
      await db.owner.query(`UPDATE ticket_sla_clocks SET due_at = now() - interval '1 hour' WHERE ticket_id = $1 AND completed_at IS NULL`, [ticket.id]);
      await mail.module.get(SlaOverdueJob).runOnce();
      await fanOut();
      expect((await typesOf(worker, ticket.id)).includes('SLA_OVERDUE')).toBe(true);
      expect((await typesOf(observer, ticket.id)).filter((type) => type === 'OBSERVER_UPDATE').length).toBeGreaterThanOrEqual(2);
    });

    it('an SLA clock at 80 % of its time: only the responsible person, once (observers hear if it goes overdue)', async () => {
      const ticket = await create();
      await fanOut();
      await db.owner.query(`UPDATE ticket_sla_clocks SET started_at = now() - interval '9 hours', due_at = now() + interval '1 hour' WHERE ticket_id = $1 AND completed_at IS NULL`, [ticket.id]);
      const observerBefore = (await typesOf(observer, ticket.id)).length;
      await mail.module.get(SlaWarningJob).runOnce();
      await mail.module.get(SlaWarningJob).runOnce();
      await fanOut();
      expect((await typesOf(worker, ticket.id)).filter((type) => type === 'SLA_WARNING')).toHaveLength(1);
      expect((await typesOf(observer, ticket.id)).length).toBe(observerBefore);
    });

    it('a warning for a clock that went overdue meanwhile tells nobody', async () => {
      const ticket = await create();
      await fanOut();
      await db.owner.query(`UPDATE ticket_sla_clocks SET started_at = now() - interval '9 hours', due_at = now() + interval '1 hour' WHERE ticket_id = $1 AND completed_at IS NULL`, [ticket.id]);
      await mail.module.get(SlaWarningJob).runOnce();
      await db.owner.query(`UPDATE ticket_sla_clocks SET alerted_at = now() WHERE ticket_id = $1 AND completed_at IS NULL`, [ticket.id]);
      await fanOut();
      expect((await typesOf(worker, ticket.id)).includes('SLA_WARNING')).toBe(false);
    });

    it('an SLA alert for a clock that finished meanwhile tells nobody', async () => {
      const ticket = await create();
      await fanOut();
      await db.owner.query(`UPDATE ticket_sla_clocks SET due_at = now() - interval '1 hour' WHERE ticket_id = $1 AND completed_at IS NULL`, [ticket.id]);
      await mail.module.get(SlaOverdueJob).runOnce();
      await done(ticket);
      await fanOut();
      expect((await typesOf(worker, ticket.id)).includes('SLA_OVERDUE')).toBe(false);
    });

    it('a member who is no longer active, or whose role lost the read permission, is not told', async () => {
      const left = await world.member([grant('read_assigned'), grant('transition')]);
      const noRead = await world.member([grant('read_assigned'), grant('transition')]);
      const crowded = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(left), user(noRead)] }));
      await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [world.tenant.tenantId, left.userId]);
      const roleOf = (await db.platform.query<{ role_id: string }>('SELECT role_id FROM memberships WHERE tenant_id = $1 AND user_id = $2', [world.tenant.tenantId, noRead.userId])).rows[0]!.role_id;
      await db.platform.query('DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2', [world.tenant.tenantId, roleOf]);
      const ticket = (await requester.client.post('/tickets', { subcategoryId: crowded.subcategoryId, title: 'Crowded', values: {} }).expect(201)).body;
      await fanOut();
      const rows = await db.platform.query('SELECT user_id FROM notifications WHERE ticket_id = $1 AND user_id = ANY($2::uuid[])', [ticket.id, [left.userId, noRead.userId]]);
      expect(rows.rowCount).toBe(0);
    });
  });

  describe('e-mail', () => {
    it('is sent to the people told, with a fixed subject (no title), an escaped body and a link to the ticket', async () => {
      const mailbox = await emailOf(worker);
      const title = `<img src=x onerror=alert(1)> "quoted" & secret`;
      mail.mailer.clear();
      const ticket = await create(title);
      await fanOut();
      const message = mail.mailer.to(mailbox).find((candidate) => candidate.subject.includes('Se te asignó'))!;
      expect(message.subject).toMatch(/^Se te asignó el ticket #\d+$/);
      expect(message.subject).not.toContain('secret');
      expect(message.html).not.toContain('<img');
      expect(message.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(message.text).toContain(title);
      expect(message.text).toContain(`http://web.test/tickets/${ticket.id}?tenant=${world.tenant.tenantId}`);
      expect(message.messageId).toMatch(/^<[0-9a-f-]{36}@procesabpm\.local>$/);
    });

    it('respects the preferences: in-app off keeps the e-mail, e-mail off keeps the in-app notice', async () => {
      const picky = await world.member([grant('read_assigned'), grant('transition')]);
      const pickyFlow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(picky)] }));
      await picky.client.put('/notifications/preferences/TICKET_ASSIGNED', { inApp: false, email: true }).expect(200);
      const first = (await requester.client.post('/tickets', { subcategoryId: pickyFlow.subcategoryId, title: 'A', values: {} }).expect(201)).body;
      await fanOut();
      expect(await typesOf(picky, first.id)).toEqual([]);
      expect(mail.mailer.to(await emailOf(picky))).toHaveLength(1);

      await picky.client.put('/notifications/preferences/TICKET_ASSIGNED', { inApp: true, email: false }).expect(200);
      const second = (await requester.client.post('/tickets', { subcategoryId: pickyFlow.subcategoryId, title: 'B', values: {} }).expect(201)).body;
      await fanOut();
      expect(await typesOf(picky, second.id)).toEqual(['TICKET_ASSIGNED']);
      expect(mail.mailer.to(await emailOf(picky))).toHaveLength(1);
    });

    it('a failed delivery is retried later and the person gets one e-mail, not two', async () => {
      const mailbox = await emailOf(worker);
      const before = mail.mailer.to(mailbox).length;
      await create();
      await fanOut();
      const sent = mail.mailer.to(mailbox).length;
      expect(sent).toBe(before + 1);
      mail.mailer.failNextTo(mailbox, new Error('smtp down'));
      await create();
      await fanOut();
      expect(mail.mailer.to(mailbox).length).toBe(sent);
      await db.owner.query(`UPDATE outbox_events SET available_at = now() WHERE tenant_id = $1 AND type = 'notification.email' AND status = 'PENDING' AND attempts > 0`, [world.tenant.tenantId]);
      await fanOut();
      expect(mail.mailer.to(mailbox).length).toBe(sent + 1);
    });

    it('a suspended organization keeps the in-app notice but sends no e-mail', async () => {
      const quiet = await TicketWorld.create(db, app);
      const [maker, doer] = [await quiet.member([grant('create'), grant('read_created')]), await quiet.member([grant('read_assigned'), grant('transition')])];
      const quietFlow = await publishFlow(quiet.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(doer)] }));
      const ticket = (await maker.client.post('/tickets', { subcategoryId: quietFlow.subcategoryId, title: 'Quiet', values: {} }).expect(201)).body;
      await db.platform.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [quiet.tenant.tenantId]);
      const mailbox = await emailOf(doer).catch(() => undefined);
      await fanOut();
      const rows = await db.platform.query('SELECT 1 FROM notifications WHERE ticket_id = $1 AND user_id = $2', [ticket.id, doer.userId]);
      expect(rows.rowCount).toBe(1);
      expect(mailbox === undefined || mail.mailer.to(mailbox).length === 0).toBe(true);
    });
  });

  describe('robustness', () => {
    it('processing the same event again notifies nobody twice', async () => {
      const ticket = await create();
      await fanOut();
      const count = async () => (await db.platform.query('SELECT count(*)::int AS n FROM notifications WHERE ticket_id = $1', [ticket.id])).rows[0].n as number;
      const before = await count();
      await db.owner.query(`UPDATE outbox_events SET status = 'PENDING', processed_at = NULL, attempts = 0, available_at = now() WHERE tenant_id = $1 AND payload ->> 'ticketId' = $2 AND type LIKE 'ticket.%'`, [world.tenant.tenantId, ticket.id]);
      await fanOut();
      expect(await count()).toBe(before);
    });

    it('an event with a payload the handler cannot read fails for good, without retries', async () => {
      const { rows } = await db.owner.query<{ id: string }>(`INSERT INTO outbox_events (tenant_id, type, payload) VALUES ($1, 'ticket.closed', '{"nonsense": true}') RETURNING id`, [world.tenant.tenantId]);
      await fanOut();
      const state = await db.owner.query<{ status: string; last_error: string }>('SELECT status, last_error FROM outbox_events WHERE id = $1', [rows[0]!.id]);
      expect(state.rows[0]).toMatchObject({ status: 'FAILED', last_error: 'PermanentEventError' });
    });

    it('an event for a ticket that no longer exists completes without notifying', async () => {
      const { rows } = await db.owner.query<{ id: string }>(`INSERT INTO outbox_events (tenant_id, type, payload) VALUES ($1, 'ticket.closed', jsonb_build_object('ticketId', gen_random_uuid()::text)) RETURNING id`, [world.tenant.tenantId]);
      await fanOut();
      expect((await db.owner.query<{ status: string }>('SELECT status FROM outbox_events WHERE id = $1', [rows[0]!.id])).rows[0]!.status).toBe('DONE');
    });

    it('two workers at once: every event is processed exactly once and nobody is notified twice', async () => {
      const second = await MailWorker.start();
      try {
        const tickets: string[] = [];
        for (let index = 0; index < 12; index += 1) tickets.push((await create()).id);
        await Promise.all([mail.deliver(), second.deliver()]);
        await Promise.all([mail.deliver(), second.deliver()]);
        const events = await db.owner.query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM outbox_events WHERE tenant_id = $1 AND payload ->> 'ticketId' = ANY($2::text[]) GROUP BY status`, [world.tenant.tenantId, tickets]);
        expect(events.rows.map((row) => row.status)).toEqual(['DONE']);
        const duplicates = await db.platform.query(`SELECT user_id, source_event_id FROM notifications WHERE ticket_id = ANY($1::uuid[]) GROUP BY user_id, source_event_id HAVING count(*) > 1`, [tickets]);
        expect(duplicates.rowCount).toBe(0);
        const assigned = await db.platform.query(`SELECT 1 FROM notifications WHERE ticket_id = ANY($1::uuid[]) AND user_id = $2 AND type = 'TICKET_ASSIGNED'`, [tickets, worker.userId]);
        expect(assigned.rowCount).toBe(12);
        const mails = [...mail.mailer.to(await emailOf(worker)), ...second.mailer.to(await emailOf(worker))].filter((message) => message.subject.startsWith('Se te asignó'));
        expect(new Set(mails.map((message) => message.messageId)).size).toBe(mails.length);
      } finally {
        await second.close();
      }
    });
  });

  describe('endpoints', () => {
    let ticketId: string;

    beforeAll(async () => {
      ticketId = (await create()).id;
      await fanOut();
    });

    it('lists my notifications newest first, paged, with the unread filter and counter', async () => {
      const all = (await worker.client.get('/notifications?pageSize=2').expect(200)).body;
      expect(all).toMatchObject({ page: 1, pageSize: 2 });
      expect(all.total).toBeGreaterThan(2);
      expect(all.items).toHaveLength(2);
      const unread = (await worker.client.get('/notifications/unread-count').expect(200)).body.count as number;
      expect(unread).toBe(all.total);
      expect((await worker.client.get('/notifications?unread=false').expect(200)).body.total).toBe(0);
    });

    it('marks one as read (idempotently, keeping the first reading time), then all of them', async () => {
      const [first] = await notificationsOf(worker);
      await worker.client.post(`/notifications/${first!.id}/read`).expect(204);
      const readAt = (await notificationsOf(worker)).find((notification) => notification.id === first!.id)!.readAt;
      expect(readAt).not.toBeNull();
      await worker.client.post(`/notifications/${first!.id}/read`).expect(204);
      expect((await notificationsOf(worker)).find((notification) => notification.id === first!.id)!.readAt).toBe(readAt);

      const before = (await worker.client.get('/notifications/unread-count').expect(200)).body.count as number;
      expect((await worker.client.post('/notifications/read-all').expect(200)).body.updated).toBe(before);
      expect((await worker.client.get('/notifications/unread-count').expect(200)).body.count).toBe(0);
      await worker.client.post('/notifications/0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90/read').expect(404);
      await worker.client.post('/notifications/not-a-uuid/read').expect(400);
    });

    it('preferences list every type with the defaults, and saving one changes only that type', async () => {
      const fresh = await world.member([grant('read_created')]);
      const before = (await fresh.client.get('/notifications/preferences').expect(200)).body as Array<{ type: string; inApp: boolean; email: boolean }>;
      expect(before).toHaveLength(13);
      expect(before.every((preference) => preference.inApp && preference.email)).toBe(true);
      expect((await fresh.client.put('/notifications/preferences/TICKET_CLOSED', { inApp: false, email: false }).expect(200)).body).toEqual({ type: 'TICKET_CLOSED', inApp: false, email: false });
      const after = (await fresh.client.get('/notifications/preferences').expect(200)).body as typeof before;
      expect(after.filter((preference) => !preference.inApp)).toEqual([{ type: 'TICKET_CLOSED', inApp: false, email: false }]);
      await fresh.client.put('/notifications/preferences/NOPE', { inApp: true, email: true }).expect(400);
      await fresh.client.put('/notifications/preferences/TICKET_CLOSED', { inApp: true }).expect(400);
    });

    it('needs a signed-in user', async () => {
      const response = await (await import('supertest')).default(app.getHttpServer()).get('/notifications');
      expectStatus(response, 401);
    });
  });

  describe('tenant isolation', () => {
    it("another tenant, and another user of the same tenant, see and touch nothing of mine", async () => {
      const ticket = await create();
      await fanOut();
      const mine = (await notificationsOf(worker)).find((notification) => notification.ticketId === ticket.id)!;
      const foreign = await TicketWorld.create(db, app);
      const outsider = await foreign.member([grant('read_created')]);

      for (const other of [outsider, foreign.admin as unknown as Member['client'], stranger.client, requester.client]) {
        const client = 'client' in (other as object) ? (other as unknown as Member).client : (other as Member['client']);
        expect(((await client.get('/notifications?pageSize=100').expect(200)).body.items as NotificationBody[]).some((notification) => notification.id === mine.id)).toBe(false);
        await client.post(`/notifications/${mine.id}/read`).expect(404);
      }
      expect((await notificationsOf(worker)).find((notification) => notification.id === mine.id)!.readAt).toBeNull();
      expect((await outsider.client.get('/notifications/unread-count').expect(200)).body.count).toBe(0);
    });

    it("the reader filter of one tenant never looks at another's roles: a foreign user id in a payload notifies nobody", async () => {
      const foreign = await TicketWorld.create(db, app);
      const outsider = await foreign.member([grant('read_assigned')]);
      const ticket = await create();
      await fanOut();
      await db.owner.query(`INSERT INTO outbox_events (tenant_id, type, payload) VALUES ($1, 'ticket.assigned', jsonb_build_object('ticketId', $2::text, 'userId', $3::text))`, [world.tenant.tenantId, ticket.id, outsider.userId]);
      await fanOut();
      expect((await db.platform.query('SELECT 1 FROM notifications WHERE user_id = $1', [outsider.userId])).rowCount).toBe(0);
    });
  });
});

import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, SUPERVISOR_GRANTS, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });

describe('editing what a ticket says', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let editor: Member;
  let flow: PublishedFlow;
  let high: string;
  let retired: string;

  const priority = (name: string, isActive: boolean) =>
    insertReturningId(db.platform, `INSERT INTO priorities (tenant_id, name, is_active) VALUES ($1, $2, $3) RETURNING id`, [world.tenant.tenantId, unique(name), isActive]);
  const header = async (ticketId: string) =>
    (await db.platform.query<{ title: string; description_html: string; priority_id: string | null }>(`SELECT title, description_html, priority_id FROM tickets WHERE tenant_id = $1 AND id = $2`, [world.tenant.tenantId, ticketId])).rows[0]!;
  const create = async () => (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Printer', description: '<p>It does not print</p>', values: {} }).expect(201)).body as { id: string; openVisitId: string };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member(REQUESTER_GRANTS);
    worker = await world.member(WORKER_GRANTS);
    editor = await world.member([...SUPERVISOR_GRANTS, grant('update')]);
    flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [{ participantType: 'USER', userId: worker.userId }] }));
    high = await priority('High', true);
    retired = await priority('Old', false);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('changes the subject, description and priority, sanitizing the description, and keeps the previous values in the timeline', async () => {
    const ticket = await create();

    const { eventId } = (await editor.client.patch(`/tickets/${ticket.id}`, { title: 'Printer on floor 3', description: '<p>Paper jam</p><script>alert(1)</script>', priorityId: high }).expect(200)).body;

    expect(await header(ticket.id)).toEqual({ title: 'Printer on floor 3', description_html: '<p>Paper jam</p>', priority_id: high });
    const edited = (await world.events(ticket.id)).filter((event) => event.type === 'FIELDS_UPDATED');
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({ actor_id: editor.userId, data: { source: 'EDIT', changes: [
      { code: 'title', before: 'Printer', after: 'Printer on floor 3' },
      { code: 'descriptionHtml', before: '<p>It does not print</p>', after: '<p>Paper jam</p>' },
      { code: 'priorityId', before: null, after: high },
    ] } });
    expect(eventId).toEqual(expect.any(String));
  });

  it('records nothing when nothing changes, and takes the priority off with null', async () => {
    const ticket = await create();
    await editor.client.patch(`/tickets/${ticket.id}`, { priorityId: high }).expect(200);

    expect((await editor.client.patch(`/tickets/${ticket.id}`, { title: 'Printer' }).expect(200)).body).toEqual({ eventId: null });
    await editor.client.patch(`/tickets/${ticket.id}`, { priorityId: null }).expect(200);

    expect((await header(ticket.id)).priority_id).toBeNull();
    expect((await world.events(ticket.id)).filter((event) => event.type === 'FIELDS_UPDATED')).toHaveLength(2);
  });

  it('refuses an inactive or unknown priority, an empty body, and a closed ticket', async () => {
    const ticket = await create();
    expect((await editor.client.patch(`/tickets/${ticket.id}`, { priorityId: retired }).expect(422)).body.error.code).toBe('INVALID_REFERENCE');
    await editor.client.patch(`/tickets/${ticket.id}`, {}).expect(400);
    await editor.client.patch(`/tickets/${ticket.id}`, { title: '  ' }).expect(400);

    await worker.client.post(`/tickets/${ticket.id}/transition`, { transitionId: flow.transition.Done, visitId: ticket.openVisitId }).expect(200);
    await editor.client.patch(`/tickets/${ticket.id}`, { title: 'Too late' }).expect(422);
  });

  it('is only for whoever holds the update permission: not the requester, nor the assignee', async () => {
    const ticket = await create();
    await requester.client.patch(`/tickets/${ticket.id}`, { title: 'Mine' }).expect(403);
    await worker.client.patch(`/tickets/${ticket.id}`, { title: 'Mine' }).expect(403);
    expect((await editor.client.get(`/tickets/${ticket.id}`).expect(200)).body.actions.edit).toBe(true);
    expect((await worker.client.get(`/tickets/${ticket.id}`).expect(200)).body.actions.edit).toBe(false);
  });
});

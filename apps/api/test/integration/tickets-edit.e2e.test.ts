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

  describe('correcting the recorded values', () => {
    let withFields: PublishedFlow;
    const values = async (ticketId: string) =>
      Object.fromEntries(
        (await db.platform.query<{ code: string; value: unknown }>(`SELECT f.code, v.value FROM ticket_field_values v JOIN fields f ON f.tenant_id = v.tenant_id AND f.id = v.field_id WHERE v.tenant_id = $1 AND v.ticket_id = $2`, [world.tenant.tenantId, ticketId])).rows.map((row) => [row.code, row.value]),
      );

    beforeAll(async () => {
      withFields = await publishFlow(world.admin, {
        ...simpleFlow({ assignmentMode: 'USERS' }, { candidates: [{ participantType: 'USER', userId: worker.userId }] }),
        fields: [
          { step: 'start', code: 'AMOUNT', type: 'CURRENCY', capture: 'CREATION', isRequired: true },
          { step: 'start', code: 'BRANCH', type: 'TEXT', capture: 'CREATION' },
          { step: 'start', code: 'FIXED', type: 'TEXT', capture: 'CREATION', isReadOnly: true },
          { step: 'start', code: 'LEAVES', type: 'DATE', capture: 'CREATION', isImmutable: true },
          { step: 'task', code: 'NOTE', type: 'TEXT', capture: 'STEP' },
        ],
        rules: [{ step: 'start', fieldCode: 'AMOUNT', maxAmount: '100000.00', action: 'BLOCK', message: 'Over the absolute limit' }],
      });
    });

    const createWithValues = async () =>
      (await requester.client.post('/tickets', { subcategoryId: withFields.subcategoryId, title: 'Refund', values: { AMOUNT: '1500', BRANCH: 'North', LEAVES: '2026-11-10' } }).expect(201)).body as { id: string; openVisitId: string };

    it('changes a recorded value, validated like an answer, and keeps the previous one in the timeline', async () => {
      const ticket = await createWithValues();

      await editor.client.patch(`/tickets/${ticket.id}`, { values: { AMOUNT: '1800.50' } }).expect(200);

      expect(await values(ticket.id)).toMatchObject({ AMOUNT: 1800.5, BRANCH: 'North' });
      const edited = (await world.events(ticket.id)).filter((event) => event.type === 'FIELDS_UPDATED' && (event.data as { source?: string }).source === 'EDIT');
      expect(edited).toHaveLength(1);
      expect(edited[0]).toMatchObject({ actor_id: editor.userId, data: { changes: [{ code: 'AMOUNT', before: 1500, after: 1800.5 }] } });
    });

    it('refuses a field without a value, a read-only or unknown one, a wrong value and an amount over its cap', async () => {
      const ticket = await createWithValues();
      const refused = async (body: Record<string, unknown>) => {
        const response = await editor.client.patch(`/tickets/${ticket.id}`, { values: body });
        expect({ body, status: response.status }).toEqual({ body, status: 422 });
        return response.body.error;
      };

      expect((await refused({ NOTE: 'later' })).details.issues).toEqual([{ code: 'NOT_EDITABLE', fieldCode: 'NOTE' }]);
      expect((await refused({ NOPE: 'x' })).details.issues).toEqual([{ code: 'NOT_EDITABLE', fieldCode: 'NOPE' }]);
      // Captured once, like the dates of a trip in the help desk: nobody corrects it afterwards.
      expect((await refused({ LEAVES: '2026-11-11' })).details.issues).toEqual([{ code: 'NOT_EDITABLE', fieldCode: 'LEAVES' }]);
      expect((await refused({ AMOUNT: 'abc' })).details.issues).toEqual([expect.objectContaining({ fieldCode: 'AMOUNT' })]);
      expect((await refused({ AMOUNT: '200000' })).code).toBe('AMOUNT_LIMIT_EXCEEDED');
      expect(await values(ticket.id)).toMatchObject({ AMOUNT: 1500, LEAVES: '2026-11-10' });
    });
  });
});


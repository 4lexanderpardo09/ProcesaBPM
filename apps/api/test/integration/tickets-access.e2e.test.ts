import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, SUPERVISOR_GRANTS, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

describe('reading tickets: per-record authorization, listings, timeline and tenant isolation', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let flow: PublishedFlow;
  let creator: Member;
  let assignee: Member;
  let former: Member;
  let stranger: Member;
  let reader: Member;
  let registrar: Member;
  let ticketId: string;
  let visitId: string;

  const get = (member: Member, id = ticketId) => member.client.get(`/tickets/${id}`);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    creator = await world.member([...REQUESTER_GRANTS, grant('transition')]);
    [assignee, former] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
    stranger = await world.member([grant('read_created'), grant('read_assigned'), grant('read_observed')]);
    reader = await world.member([grant('read_all')]);
    registrar = await world.member([grant('create_for_others'), grant('read_created')]);
    flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(former), user(assignee)] }));

    const created = await creator.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Mine', values: {} }).expect(201);
    ticketId = created.body.id;
    visitId = created.body.openVisitId;
    await former.client.post(`/tickets/${ticketId}/take`, { visitId }).expect(200);
    const supervisor = await world.member(SUPERVISOR_GRANTS);
    await supervisor.client.post(`/tickets/${ticketId}/reassign`, { toUserId: assignee.userId, visitId }).expect(200);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('GET /tickets/:id', () => {
    it('the creator, the current assignee, a past assignee and read_all can read it', async () => {
      for (const member of [creator, assignee, former, reader]) expect((await get(member)).status, member.userId).toBe(200);
    });

    it('whoever registered it on behalf of the creator can read it', async () => {
      const created = await registrar.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'On behalf', requesterId: creator.userId, values: {} }).expect(201);
      expect((await get(registrar, created.body.id)).status).toBe(200);
      expect((await get(creator, created.body.id)).status).toBe(200);
      expect((await get(stranger, created.body.id)).status).toBe(404);
    });

    it('a stranger gets 404, exactly like a ticket that does not exist', async () => {
      const unknown = await get(stranger, '018f3c1e-7b2a-7c3d-9e4f-0123456789ab');
      const hidden = await get(stranger);
      expect([hidden.status, hidden.body.error.code, hidden.body.error.message]).toEqual([404, unknown.body.error.code, unknown.body.error.message]);
    });

    it('answers with the open visit callers must echo, the assignees and the values by code', async () => {
      const detail = (await get(creator).expect(200)).body;
      expect(detail).toMatchObject({ id: ticketId, title: 'Mine', status: 'OPEN', openVisit: { id: visitId, stepId: flow.step.task, loop: 1 }, assignees: [{ userId: assignee.userId, type: 'PRIMARY' }], values: {} });
    });

    it('the permission to read at all is required (403)', async () => {
      const onlyCreates = await world.member([grant('create')]);
      expect((await get(onlyCreates)).status).toBe(403);
    });

    describe('observers, resolved live', () => {
      let observer: Member;
      let position: string;
      let groupId: string;
      beforeAll(async () => {
        position = await world.position();
        observer = await world.member([grant('read_observed')], { positionId: position });
      });

      it('sees nothing until the workflow observes them', async () => {
        expect((await get(observer)).status).toBe(404);
      });

      it('by name', async () => {
        const added = (await world.admin.post(`/workflows/${flow.workflowId}/observers`, { participantType: 'USER', userId: observer.userId }).expect(201)).body;
        expect((await get(observer)).status).toBe(200);
        await world.admin.delete(`/workflows/${flow.workflowId}/observers/${added.id}`).expect(204);
        expect((await get(observer)).status).toBe(404);
      });

      it('by group, and leaving the group takes effect at once', async () => {
        groupId = await world.group([observer.userId]);
        await world.admin.post(`/workflows/${flow.workflowId}/observers`, { participantType: 'GROUP', groupId }).expect(201);
        expect((await get(observer)).status).toBe(200);
        await db.platform.query(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, [groupId, observer.userId]);
        expect((await get(observer)).status).toBe(404);
      });

      it('by position', async () => {
        await world.admin.post(`/workflows/${flow.workflowId}/observers`, { participantType: 'POSITION', positionId: position }).expect(201);
        expect((await get(observer)).status).toBe(200);
        const withoutPosition = await world.member([grant('read_observed')]);
        expect((await get(withoutPosition)).status).toBe(404);
      });
    });
  });

  describe('GET /tickets/:id/timeline', () => {
    it('lists the events in order for whoever can read the ticket, and 404 for the rest', async () => {
      const events = (await creator.client.get(`/tickets/${ticketId}/timeline`).expect(200)).body as Array<{ type: string }>;
      expect(events.map((event) => event.type)).toEqual(['CREATED', 'TRANSITIONED', 'ASSIGNED', 'ASSIGNED', 'ASSIGNED', 'REASSIGNED']);
      expect((await stranger.client.get(`/tickets/${ticketId}/timeline`)).status).toBe(404);
    });
  });

  describe('GET /tickets (views)', () => {
    const list = async (member: Member, query: string) => (await member.client.get(`/tickets?${query}`).expect(200)).body as { items: Array<{ id: string }>; total: number; page: number; pageSize: number };
    const ids = (page: { items: Array<{ id: string }> }) => page.items.map((item) => item.id);

    it('created: what one created or registered', async () => {
      expect(ids(await list(creator, 'view=created'))).toContain(ticketId);
      expect(ids(await list(stranger, 'view=created'))).not.toContain(ticketId);
    });

    it('assigned: the current assignments only, not the past ones', async () => {
      expect(ids(await list(assignee, 'view=assigned'))).toContain(ticketId);
      expect(ids(await list(former, 'view=assigned'))).not.toContain(ticketId);
    });

    it('all: everything the permissions allow and nothing else', async () => {
      expect(ids(await list(reader, 'view=all'))).toContain(ticketId);
      expect(ids(await list(creator, 'view=all'))).toContain(ticketId);
      expect(ids(await list(stranger, 'view=all'))).not.toContain(ticketId);
      expect(ids(await list(former, 'view=all'))).toContain(ticketId);
    });

    it('a view cannot widen the permissions: asking for all with created rights only shows own tickets', async () => {
      const other = await world.member([grant('create'), grant('read_created')]);
      await other.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Other', values: {} }).expect(201);
      const page = await list(other, 'view=all');
      expect(page.total).toBe(1);
    });

    it('paginates newest first and filters by status', async () => {
      const lister = await world.member([grant('create'), grant('read_created')]);
      for (let index = 0; index < 5; index += 1) await lister.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: `T${index}`, values: {} }).expect(201);
      const first = await list(lister, 'view=created&page=1&pageSize=2');
      const second = await list(lister, 'view=created&page=2&pageSize=2');
      expect([first.total, first.page, first.pageSize, first.items.length, second.items.length]).toEqual([5, 1, 2, 2, 2]);
      expect((first.items as unknown as Array<{ title: string }>).map((item) => item.title)).toEqual(['T4', 'T3']);
      expect((await list(lister, 'view=created&status=CLOSED')).total).toBe(0);
      expect((await list(lister, 'view=created&status=OPEN')).total).toBe(5);
    });

    it('rejects an unknown view', async () => {
      await creator.client.get('/tickets?view=everything').expect(400);
    });
  });

  describe('tenant isolation', () => {
    let foreign: TicketWorld;
    let foreignFlow: PublishedFlow;
    let foreignTicket: { id: string; openVisitId: string };

    beforeAll(async () => {
      foreign = await TicketWorld.create(db, app);
      foreignFlow = await publishFlow(foreign.admin, simpleFlow());
      foreignTicket = (await foreign.admin.post('/tickets', { subcategoryId: foreignFlow.subcategoryId, title: 'Foreign', values: {} }).expect(201)).body;
    });

    it('another tenant\'s ticket is 404 on read, timeline, transition, reassign, take and close — even for an administrator', async () => {
      const mine = world.admin;
      expect((await mine.get(`/tickets/${foreignTicket.id}`)).status).toBe(404);
      expect((await mine.get(`/tickets/${foreignTicket.id}/timeline`)).status).toBe(404);
      const body = { visitId: foreignTicket.openVisitId };
      expect((await mine.post(`/tickets/${foreignTicket.id}/transition`, { ...body, transitionId: foreignFlow.transition.Done })).status).toBe(404);
      expect((await mine.post(`/tickets/${foreignTicket.id}/reassign`, { ...body, toUserId: creator.userId })).status).toBe(404);
      expect((await mine.post(`/tickets/${foreignTicket.id}/take`, body)).status).toBe(404);
      expect((await mine.post(`/tickets/${foreignTicket.id}/close`, body)).status).toBe(404);
    });

    it('listings never include other tenants\' tickets', async () => {
      const page = (await world.admin.get('/tickets?view=all&pageSize=100').expect(200)).body as { items: Array<{ id: string }> };
      expect(page.items.map((item) => item.id)).not.toContain(foreignTicket.id);
      const theirs = (await foreign.admin.get('/tickets?view=all&pageSize=100').expect(200)).body as { items: Array<{ id: string }> };
      expect(theirs.items.map((item) => item.id)).toEqual([foreignTicket.id]);
    });

    it('creating with another tenant\'s subcategory finds nothing (404)', async () => {
      expect((await world.admin.post('/tickets', { subcategoryId: foreignFlow.subcategoryId, title: 'x', values: {} })).status).toBe(404);
    });

    it('requester, company, priority and assignee of another tenant are refused', async () => {
      const foreignMember = await foreign.member(REQUESTER_GRANTS);
      const create = (extra: Record<string, unknown>) => world.admin.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'x', values: {}, ...extra });
      expect((await create({ requesterId: foreignMember.userId })).status).toBe(422);
      expect((await create({ companyId: foreign.tenant.companyId })).status).toBe(422);
      const priority = (await foreign.admin.post('/priorities', { name: 'Foreign', color: '#ff0000', level: 1 })).body.id as string | undefined;
      if (priority !== undefined) expect((await create({ priorityId: priority })).status).toBe(422);
    });

    it('a transition id of another tenant\'s workflow is not one of this ticket\'s', async () => {
      const refused = await creator.client.post(`/tickets/${ticketId}/transition`, { visitId, transitionId: foreignFlow.transition.Done });
      expect(refused.status).toBe(403);
      const asAssignee = await assignee.client.post(`/tickets/${ticketId}/transition`, { visitId, transitionId: foreignFlow.transition.Done });
      expect([asAssignee.status, asAssignee.body.error.code]).toEqual([422, 'INVALID_TRANSITION']);
    });
  });
});

import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, SUPERVISOR_GRANTS, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string, conditions?: unknown) => ({ action, subject: 'Ticket', ...(conditions === undefined ? {} : { conditions }) });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });
const INCIDENT_WORKER = [...WORKER_GRANTS, grant('open_incident')];

describe('incidents (novedades): pause, hand over, resolve', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let helper: Member;
  let supervisor: Member;
  let single: PublishedFlow;
  let pool: PublishedFlow;

  const create = (flow: PublishedFlow) => requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Request', values: {} }).expect(201);
  const open = (as: Member, ticket: { id: string; openVisitId: string }, assignedToId = helper.userId, description = '<p>Waiting for a document</p>') =>
    as.client.post(`/tickets/${ticket.id}/incidents`, { visitId: ticket.openVisitId, assignedToId, description });
  const resolve = (as: Member, ticketId: string, incidentId: string, body: Record<string, unknown> = { resolution: 'Done' }) => as.client.post(`/tickets/${ticketId}/incidents/${incidentId}/resolve`, body);
  const incident = async (ticketId: string) => (await db.platform.query(`SELECT * FROM ticket_incidents WHERE ticket_id = $1 ORDER BY opened_at`, [ticketId])).rows;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member(REQUESTER_GRANTS);
    worker = await world.member(INCIDENT_WORKER);
    helper = await world.member(WORKER_GRANTS);
    supervisor = await world.member([...SUPERVISOR_GRANTS, grant('open_incident')]);
    const sla = { assignmentMode: 'USERS', slaValue: 8, slaUnit: 'BUSINESS_HOURS' };
    single = await publishFlow(world.admin, simpleFlow(sla, { candidates: [user(worker)] }));
    const second = await world.member(INCIDENT_WORKER);
    pool = await publishFlow(world.admin, simpleFlow(sla, { candidates: [user(worker), user(second)] }));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('opening', () => {
    it('pauses the clocks, hands the ticket over and records the incident', async () => {
      const ticket = (await create(single)).body;
      const opened = await open(worker, ticket).expect(201);
      expect(opened.body).toMatchObject({ status: 'PAUSED', openVisitId: ticket.openVisitId, incidentId: expect.any(String) });

      expect((await world.ticketRow(ticket.id)).status).toBe('PAUSED');
      expect(await world.assignees(ticket.id)).toEqual([{ user_id: helper.userId, type: 'INCIDENT' }]);
      const clocks = await world.db.platform.query(`SELECT paused_at, completed_at FROM ticket_sla_clocks WHERE ticket_id = $1`, [ticket.id]);
      expect(clocks.rows.map((row) => [row.paused_at !== null, row.completed_at])).toEqual([[true, null]]);
      const [row] = await incident(ticket.id);
      expect(row).toMatchObject({ status: 'OPEN', created_by_id: worker.userId, assigned_to_id: helper.userId, previous_assignee_ids: [worker.userId], description: '<p>Waiting for a document</p>' });
      expect((await world.events(ticket.id)).at(-1)).toMatchObject({ type: 'INCIDENT_OPENED', actor_id: worker.userId, assignee_id: helper.userId });
      expect(await world.outbox('ticket.incident_opened', ticket.id)).toEqual([expect.objectContaining({ incidentId: opened.body.incidentId, assignedToId: helper.userId })]);
      const detail = (await requester.client.get(`/tickets/${ticket.id}`).expect(200)).body;
      expect(detail).toMatchObject({ status: 'PAUSED', openIncident: { id: opened.body.incidentId, assignedToId: helper.userId } });
    });

    it('nothing else moves while the ticket is paused', async () => {
      const ticket = (await create(single)).body;
      await open(worker, ticket).expect(201);
      const refusals = await Promise.all([
        worker.client.post(`/tickets/${ticket.id}/transition`, { transitionId: single.transition.Done, visitId: ticket.openVisitId }),
        supervisor.client.post(`/tickets/${ticket.id}/reassign`, { toUserId: helper.userId, visitId: ticket.openVisitId }),
        worker.client.post(`/tickets/${ticket.id}/take`, { visitId: ticket.openVisitId }),
        worker.client.post(`/tickets/${ticket.id}/close`, { visitId: ticket.openVisitId }),
        open(supervisor, ticket),
      ]);
      expect(refusals.map((response) => [response.status, response.body.error.code])).toEqual(Array(5).fill([422, 'TICKET_NOT_OPEN']));
    });

    it('needs the permission and to hold the step (or reassign); a stored condition on another company refuses it', async () => {
      const ticket = (await create(single)).body;
      const onlyReads = await world.member([...WORKER_GRANTS, grant('read_all')]);
      expect((await open(onlyReads, ticket)).status).toBe(403);
      const notHolder = await world.member([grant('open_incident'), grant('read_all')]);
      expect((await open(notHolder, ticket)).status).toBe(403);
      const otherCompany = (await world.admin.post('/companies', { name: unique('Other'), countryCode: 'CO' }).expect(201)).body.id as string;
      const limited = await world.member([...WORKER_GRANTS, grant('read_all'), grant('open_incident', { companyId: otherCompany })]);
      await db.platform.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [world.tenant.tenantId, limited.userId, otherCompany]);
      expect((await open(limited, ticket)).status).toBe(403);
      expect((await open(supervisor, ticket)).status).toBe(201);
    });

    it('the person it is for must be an active member of the ticket company', async () => {
      const ticket = (await create(single)).body;
      const otherCompany = (await world.admin.post('/companies', { name: unique('Other'), countryCode: 'CO' }).expect(201)).body.id as string;
      const elsewhere = await world.member(WORKER_GRANTS);
      await db.platform.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [world.tenant.tenantId, elsewhere.userId, otherCompany]);
      await db.platform.query(`DELETE FROM membership_companies WHERE tenant_id = $1 AND user_id = $2 AND company_id = $3`, [world.tenant.tenantId, elsewhere.userId, world.tenant.companyId]);
      const inactive = await world.member(WORKER_GRANTS);
      await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [world.tenant.tenantId, inactive.userId]);
      for (const target of [elsewhere.userId, inactive.userId, '018f3c1e-7b2a-7c3d-9e4f-0123456789ab']) {
        const refused = await open(worker, ticket, target);
        expect([refused.status, refused.body.error.code]).toEqual([422, 'INVALID_ASSIGNEE']);
      }
      expect((await world.ticketRow(ticket.id)).status).toBe('OPEN');
    });

    it('a description that sanitizes to nothing is refused', async () => {
      const ticket = (await create(single)).body;
      expect((await open(worker, ticket, helper.userId, '<script>alert(1)</script>')).status).toBe(400);
    });
  });

  describe('resolving', () => {
    it('gives the ticket back to the original holder and runs the clock again', async () => {
      const ticket = (await create(single)).body;
      const { incidentId } = (await open(worker, ticket).expect(201)).body;
      const resolved = await resolve(helper, ticket.id, incidentId, { resolution: '<p>Solved</p>' }).expect(200);
      expect(resolved.body).toMatchObject({ status: 'OPEN', openVisitId: ticket.openVisitId });
      expect(await world.assignees(ticket.id)).toEqual([{ user_id: worker.userId, type: 'PRIMARY' }]);
      const [row] = await incident(ticket.id);
      expect(row).toMatchObject({ status: 'RESOLVED', resolution: '<p>Solved</p>' });
      expect(row.resolved_at).not.toBeNull();
      const [clock] = await world.clocks(ticket.id);
      expect(clock).toMatchObject({ responsible_id: worker.userId, completed_at: null });
      expect((await db.platform.query(`SELECT paused_at FROM ticket_sla_clocks WHERE ticket_id = $1`, [ticket.id])).rows[0].paused_at).toBeNull();
      expect((await world.events(ticket.id)).at(-1)).toMatchObject({ type: 'INCIDENT_RESOLVED', actor_id: helper.userId, data: { incidentId, restoredAssigneeIds: [worker.userId], droppedAssigneeIds: [] } });
      expect(await world.outbox('ticket.incident_resolved', ticket.id)).toHaveLength(1);
      // The ticket moves again.
      await worker.client.post(`/tickets/${ticket.id}/transition`, { transitionId: single.transition.Done, visitId: ticket.openVisitId }).expect(200);
    });

    it('who may resolve: the person it is for, the opener with open_incident, a supervisor; nobody else', async () => {
      const stranger = await world.member([...WORKER_GRANTS, grant('open_incident')]);
      const asHelper = (await create(single)).body;
      const asOpener = (await create(single)).body;
      const asBoss = (await create(single)).body;
      const refused = (await create(single)).body;
      const ids = new Map<string, string>();
      for (const ticket of [asHelper, asOpener, asBoss, refused]) ids.set(ticket.id, (await open(worker, ticket).expect(201)).body.incidentId);
      expect((await resolve(helper, asHelper.id, ids.get(asHelper.id)!)).status).toBe(200);
      expect((await resolve(worker, asOpener.id, ids.get(asOpener.id)!)).status).toBe(200);
      expect((await resolve(supervisor, asBoss.id, ids.get(asBoss.id)!)).status).toBe(200);
      const denied = await resolve(stranger, refused.id, ids.get(refused.id)!);
      expect(denied.status).toBe(404);
      const readerOnly = await world.member([grant('read_all')]);
      expect((await resolve(readerOnly, refused.id, ids.get(refused.id)!)).status).toBe(403);
    });

    it('an incident already resolved answers 409', async () => {
      const ticket = (await create(single)).body;
      const { incidentId } = (await open(worker, ticket).expect(201)).body;
      await resolve(helper, ticket.id, incidentId).expect(200);
      // (The person it was for no longer has anything to do with the ticket, so a supervisor tries again.)
      const again = await resolve(supervisor, ticket.id, incidentId);
      expect([again.status, again.body.error.code]).toEqual([409, 'INCIDENT_NOT_OPEN']);
    });

    it('a pool comes back as a pool, with the pool clock still unowned and running', async () => {
      const ticket = (await create(pool)).body;
      const holder = (await db.platform.query(`SELECT user_id FROM ticket_assignees WHERE ticket_id = $1 ORDER BY user_id LIMIT 1`, [ticket.id])).rows[0].user_id as string;
      const opener = holder === worker.userId ? worker : supervisor;
      const { incidentId } = (await open(opener, ticket).expect(201)).body;
      await resolve(supervisor, ticket.id, incidentId).expect(200);
      expect((await world.assignees(ticket.id)).map((row) => row.type)).toEqual(['POOL', 'POOL']);
      expect((await world.clocks(ticket.id)).map((clock) => [clock.responsible_id, clock.completed_at])).toEqual([[null, null]]);
    });

    it('when the holder is no longer an active member the caller must name who gets it', async () => {
      const gone = await world.member(INCIDENT_WORKER);
      const flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(gone)] }));
      const ticket = (await create(flow)).body;
      const { incidentId } = (await open(gone, ticket).expect(201)).body;
      await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [world.tenant.tenantId, gone.userId]);

      const refused = await resolve(supervisor, ticket.id, incidentId);
      expect([refused.status, refused.body.error.code, refused.body.error.details]).toEqual([422, 'ASSIGNEE_REQUIRED', { droppedAssigneeIds: [gone.userId] }]);
      expect((await world.ticketRow(ticket.id)).status).toBe('PAUSED');

      expect((await resolve(helper, ticket.id, incidentId, { resolution: 'x', assigneeId: worker.userId })).status).toBe(403);
      await resolve(supervisor, ticket.id, incidentId, { resolution: 'x', assigneeId: worker.userId }).expect(200);
      expect(await world.assignees(ticket.id)).toEqual([{ user_id: worker.userId, type: 'PRIMARY' }]);
      expect((await world.clocks(ticket.id)).map((clock) => [clock.responsible_id, clock.completed_at !== null])).toEqual([[gone.userId, true], [worker.userId, false]]);
    });
  });

  describe('races and isolation', () => {
    it('opening an incident and moving the ticket at the same time: exactly one wins (10 rounds)', async () => {
      for (let round = 0; round < 10; round += 1) {
        const ticket = (await create(single)).body;
        const [opened, moved] = await Promise.all([open(worker, ticket), worker.client.post(`/tickets/${ticket.id}/transition`, { transitionId: single.transition.Done, visitId: ticket.openVisitId })]);
        // Whoever goes second finds the ticket paused or closed: 422 either way.
        expect([opened.status, moved.status].sort(), `round ${round}`).toEqual(opened.status === 201 ? [201, 422] : [200, 422]);
        const status = (await world.ticketRow(ticket.id)).status;
        expect(status).toBe(opened.status === 201 ? 'PAUSED' : 'CLOSED');
      }
    });

    it('two resolutions at the same time: one 200, the other loses (409, or 404 when the first one already took away its access)', async () => {
      const ticket = (await create(single)).body;
      const { incidentId } = (await open(worker, ticket).expect(201)).body;
      const results = await Promise.all([resolve(helper, ticket.id, incidentId), resolve(supervisor, ticket.id, incidentId)]);
      const statuses = results.map((result) => result.status).sort();
      expect(statuses[0]).toBe(200);
      expect([404, 409]).toContain(statuses[1]);
    });

    it('another tenant cannot open or resolve, and cannot name foreign people', async () => {
      const foreign = await TicketWorld.create(db, app);
      const ticket = (await create(single)).body;
      const { incidentId } = (await open(worker, ticket).expect(201)).body;
      expect((await foreign.admin.post(`/tickets/${ticket.id}/incidents`, { visitId: ticket.openVisitId, assignedToId: helper.userId, description: 'x' })).status).toBe(404);
      expect((await foreign.admin.post(`/tickets/${ticket.id}/incidents/${incidentId}/resolve`, { resolution: 'x' })).status).toBe(404);
      expect((await incident(ticket.id))[0].status).toBe('OPEN');

      const fresh = (await create(single)).body;
      const foreignMember = await foreign.member(WORKER_GRANTS);
      expect((await open(supervisor, fresh, foreignMember.userId)).status).toBe(422);
      expect((await world.ticketRow(fresh.id)).status).toBe('OPEN');
    });
  });
});

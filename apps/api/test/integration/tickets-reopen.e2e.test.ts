import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, SUPERVISOR_GRANTS, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string, conditions?: unknown) => ({ action, subject: 'Ticket', ...(conditions === undefined ? {} : { conditions }) });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

describe('reopening a closed ticket', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let first: Member;
  let second: Member;
  let manager: Member;
  let twoSteps: PublishedFlow;
  let errorType: string;

  const errorTypeOf = (tenantId: string, flags: { reopening?: boolean; forcesClose?: boolean; active?: boolean; process?: boolean } = {}) =>
    insertReturningId(db.platform, `INSERT INTO error_types (tenant_id, name, is_reopening, forces_close, is_active, is_process_error) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [tenantId, unique('Type'), flags.reopening ?? true, flags.forcesClose ?? false, flags.active ?? true, flags.process ?? false]);
  const create = (flow: PublishedFlow) => requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Request', values: {} }).expect(201);
  const move = (as: Member, ticket: { id: string; openVisitId: string }, flow: PublishedFlow, label: string) => as.client.post(`/tickets/${ticket.id}/transition`, { transitionId: flow.transition[label], visitId: ticket.openVisitId }).expect(200);
  /** A ticket that went first → second → END and was closed by the second holder. */
  const closedTicket = async () => {
    const ticket = (await create(twoSteps)).body;
    const toSecond = (await move(first, ticket, twoSteps, 'Next')).body;
    await move(second, toSecond, twoSteps, 'Finish');
    return ticket.id as string;
  };
  const reopen = (as: Member, ticketId: string, body: Record<string, unknown> = {}) => as.client.post(`/tickets/${ticketId}/reopen`, { errorTypeId: errorType, description: '<p>The result was wrong</p>', ...body });

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member(REQUESTER_GRANTS);
    [first, second] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
    manager = await world.member([...SUPERVISOR_GRANTS, grant('reopen')]);
    const spec: FlowSpec = {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'first', type: 'TASK', extra: { assignmentMode: 'USERS', maxLoops: 1, slaValue: 8, slaUnit: 'BUSINESS_HOURS' }, candidates: [user(first)] },
        { key: 'second', type: 'TASK', extra: { assignmentMode: 'USERS', slaValue: 8, slaUnit: 'BUSINESS_HOURS' }, candidates: [user(second)] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'first', type: 'DEFAULT' },
        { from: 'first', to: 'second', type: 'DECISION', label: 'Next' },
        { from: 'second', to: 'end', type: 'DECISION', label: 'Finish' },
      ],
    };
    twoSteps = await publishFlow(world.admin, spec);
    errorType = await errorTypeOf(world.tenant.tenantId, { process: true });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('reopens into the last step it went through: new visit, last holder, fresh clock, error recorded, events', async () => {
    const ticketId = await closedTicket();
    const closed = await world.ticketRow(ticketId);
    const reopened = await reopen(manager, ticketId).expect(200);
    expect(reopened.body).toMatchObject({ status: 'OPEN', currentStepId: twoSteps.step.second, openVisitId: expect.any(String) });

    expect(await world.ticketRow(ticketId)).toMatchObject({ status: 'OPEN', current_step_id: twoSteps.step.second, current_loop: 2, closed_at: null, closed_by_id: null });
    expect(await world.assignees(ticketId)).toEqual([{ user_id: second.userId, type: 'PRIMARY' }]);
    const visits = await world.visits(ticketId);
    expect(visits.map((visit) => [visit.step_id, visit.loop, visit.exited_at !== null])).toEqual([[twoSteps.step.first, 1, true], [twoSteps.step.second, 1, true], [twoSteps.step.second, 2, false]]);
    expect(visits[2]!.due_at).not.toBeNull();
    const clocks = await world.clocks(ticketId);
    expect(clocks.at(-1)).toMatchObject({ responsible_id: second.userId, completed_at: null, loop: 2 });

    const [error] = (await db.platform.query(`SELECT reporter_id, responsible_id, is_process_error, error_type_id FROM ticket_errors WHERE ticket_id = $1`, [ticketId])).rows;
    expect(error).toMatchObject({ reporter_id: manager.userId, responsible_id: second.userId, is_process_error: true, error_type_id: errorType });
    const events = await world.events(ticketId);
    expect(events.at(-2)).toMatchObject({ type: 'REOPENED', actor_id: manager.userId, step_id: twoSteps.step.second });
    expect(events.at(-2)!.data).toMatchObject({ errorTypeId: errorType, responsibleId: second.userId, previousClosedById: second.userId });
    expect(events.at(-1)).toMatchObject({ type: 'ASSIGNED', assignee_id: second.userId });
    expect(await world.outbox('ticket.reopened', ticketId)).toHaveLength(1);
    expect(closed.closed_by_id).toBe(second.userId);
    // And it works again.
    await second.client.post(`/tickets/${ticketId}/transition`, { transitionId: twoSteps.transition.Finish, visitId: reopened.body.openVisitId }).expect(200);
  });

  it('can reopen into another step it went through, ignoring that step\'s max_loops', async () => {
    const ticketId = await closedTicket();
    const reopened = await reopen(manager, ticketId, { stepId: twoSteps.step.first }).expect(200);
    expect(reopened.body.currentStepId).toBe(twoSteps.step.first);
    expect(await world.ticketRow(ticketId)).toMatchObject({ current_loop: 2 });
    expect(await world.assignees(ticketId)).toEqual([{ user_id: first.userId, type: 'PRIMARY' }]);
  });

  it('only into a step the ticket has been through; a ticket that never had a person step cannot be reopened', async () => {
    const ticketId = await closedTicket();
    expect((await reopen(manager, ticketId, { stepId: twoSteps.step.end })).body.error.code).toBe('INVALID_REOPEN_STEP');
    expect((await reopen(manager, ticketId, { stepId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' })).body.error.code).toBe('INVALID_REOPEN_STEP');
    const direct = await publishFlow(world.admin, { steps: [{ key: 'start', type: 'START' }, { key: 'end', type: 'END' }], transitions: [{ from: 'start', to: 'end', type: 'DEFAULT' }] });
    const instantly = (await requester.client.post('/tickets', { subcategoryId: direct.subcategoryId, title: 'x', values: {} }).expect(201)).body;
    expect(instantly.status).toBe('CLOSED');
    const refused = await reopen(manager, instantly.id);
    expect([refused.status, refused.body.error.code]).toEqual([422, 'INVALID_REOPEN_STEP']);
  });

  it('the error type must be an active reopening type that does not force a close, with a subtype of its own', async () => {
    const ticketId = await closedTicket();
    const wrong = [
      await errorTypeOf(world.tenant.tenantId, { reopening: false }),
      await errorTypeOf(world.tenant.tenantId, { reopening: false, forcesClose: true }),
      await errorTypeOf(world.tenant.tenantId, { active: false }),
      await errorTypeOf((await TicketWorld.create(db, app)).tenant.tenantId),
      '018f3c1e-7b2a-7c3d-9e4f-0123456789ab',
    ];
    for (const errorTypeId of wrong) {
      const refused = await reopen(manager, ticketId, { errorTypeId });
      expect([refused.status, refused.body.error.code], errorTypeId).toEqual([422, 'INVALID_ERROR_TYPE']);
    }
    const otherType = await errorTypeOf(world.tenant.tenantId);
    const subtype = await insertReturningId(db.platform, `INSERT INTO error_subtypes (tenant_id, error_type_id, name) VALUES ($1, $2, $3) RETURNING id`, [world.tenant.tenantId, otherType, unique('Sub')]);
    expect((await reopen(manager, ticketId, { errorSubtypeId: subtype })).body.error.code).toBe('INVALID_ERROR_TYPE');
    await reopen(manager, ticketId, { errorTypeId: otherType, errorSubtypeId: subtype }).expect(200);
    expect((await world.ticketRow(ticketId)).status).toBe('OPEN');
  });

  it('only a closed ticket can be reopened', async () => {
    const ticket = (await create(twoSteps)).body;
    const refused = await reopen(manager, ticket.id);
    expect([refused.status, refused.body.error.code]).toEqual([422, 'TICKET_NOT_CLOSED']);
  });

  it('an explicit responsible and assignee are honoured; the assignee must be an active member of the company', async () => {
    const ticketId = await closedTicket();
    expect((await reopen(manager, ticketId, { assigneeId: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab' })).body.error.code).toBe('INVALID_ASSIGNEE');
    await reopen(manager, ticketId, { responsibleId: first.userId, assigneeId: first.userId }).expect(200);
    expect(await world.assignees(ticketId)).toEqual([{ user_id: first.userId, type: 'PRIMARY' }]);
    expect((await db.platform.query(`SELECT responsible_id FROM ticket_errors WHERE ticket_id = $1`, [ticketId])).rows[0].responsible_id).toBe(first.userId);
  });

  it('when the last holder is no longer active the step\'s own rule decides', async () => {
    const gone = await world.member(WORKER_GRANTS);
    const flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(gone)] }));
    const ticket = (await create(flow)).body;
    await move(gone, ticket, flow, 'Done');
    await db.platform.query(`UPDATE memberships SET status = 'INACTIVE' WHERE tenant_id = $1 AND user_id = $2`, [world.tenant.tenantId, gone.userId]);
    const refused = await reopen(manager, ticket.id);
    expect([refused.status, refused.body.error.code]).toEqual([422, 'NO_ASSIGNEE_CANDIDATES']);
    expect((await world.ticketRow(ticket.id)).status).toBe('CLOSED');
  });

  it('needs the reopen permission for this ticket; unreadable tickets are 404', async () => {
    const ticketId = await closedTicket();
    const otherCompany = (await world.admin.post('/companies', { name: unique('Other'), countryCode: 'CO' }).expect(201)).body.id as string;
    const limited = await world.member([grant('reopen', { companyId: otherCompany }), grant('read_all')]);
    expect((await reopen(limited, ticketId)).status).toBe(403);
    expect((await reopen(first, ticketId)).status).toBe(403);
    const blind = await world.member([grant('reopen')]);
    expect((await reopen(blind, ticketId)).status).toBe(404);
  });

  it('two reopenings at once: one wins, the other finds it open', async () => {
    const ticketId = await closedTicket();
    const results = await Promise.all([reopen(manager, ticketId), reopen(manager, ticketId)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 422]);
    expect(results.find((result) => result.status === 422)!.body.error.code).toBe('TICKET_NOT_CLOSED');
    expect((await db.platform.query(`SELECT count(*)::int AS n FROM ticket_errors WHERE ticket_id = $1`, [ticketId])).rows[0].n).toBe(1);
  });

  it('another tenant cannot reopen it, nor use error types or people of another tenant', async () => {
    const foreign = await TicketWorld.create(db, app);
    const ticketId = await closedTicket();
    const foreignManager = await foreign.member([grant('reopen'), grant('read_all')]);
    expect((await foreignManager.client.post(`/tickets/${ticketId}/reopen`, { errorTypeId: await errorTypeOf(foreign.tenant.tenantId), description: 'x' })).status).toBe(404);
    expect((await foreign.admin.post(`/tickets/${ticketId}/reopen`, { errorTypeId: errorType, description: 'x' })).status).toBe(404);
    const foreignPerson = await foreign.member(WORKER_GRANTS);
    expect((await reopen(manager, ticketId, { assigneeId: foreignPerson.userId })).status).toBe(422);
    expect((await reopen(manager, ticketId, { responsibleId: foreignPerson.userId })).status).toBe(422);
    expect((await world.ticketRow(ticketId)).status).toBe('CLOSED');
  });
});

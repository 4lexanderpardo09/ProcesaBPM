import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

describe('reporting an error on an open ticket', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let first: Member;
  let second: Member;
  let flow: PublishedFlow;
  const types: Record<'record' | 'process' | 'forced' | 'reopening', string> = { record: '', process: '', forced: '', reopening: '' };

  const errorType = (flags: { reopening?: boolean; forcesClose?: boolean; process?: boolean }) =>
    insertReturningId(db.platform, `INSERT INTO error_types (tenant_id, name, is_reopening, forces_close, is_active, is_process_error) VALUES ($1, $2, $3, $4, true, $5) RETURNING id`, [world.tenant.tenantId, unique('Type'), flags.reopening ?? false, flags.forcesClose ?? false, flags.process ?? false]);
  const create = async () => (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Request', values: {} }).expect(201)).body as { id: string; openVisitId: string };
  /** A ticket first handled by `first`, now at the second step with `second`. */
  const atSecondStep = async () => {
    const ticket = await create();
    const moved = (await first.client.post(`/tickets/${ticket.id}/transition`, { transitionId: flow.transition['Next'], visitId: ticket.openVisitId }).expect(200)).body as { openVisitId: string };
    return { id: ticket.id, visitId: moved.openVisitId };
  };
  const report = (as: Member, ticket: { id: string; visitId: string }, errorTypeId: string) => as.client.post(`/tickets/${ticket.id}/errors`, { visitId: ticket.visitId, errorTypeId, description: '<p>The amount was wrong</p>' });
  const closedState = async (ticketId: string) => (await db.platform.query(`SELECT status, forced_close FROM tickets WHERE id = $1`, [ticketId])).rows[0];
  const errorsOf = async (ticketId: string) => (await db.platform.query(`SELECT reporter_id, responsible_id, is_process_error FROM ticket_errors WHERE ticket_id = $1`, [ticketId])).rows;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member([...REQUESTER_GRANTS, grant('report_error')]);
    [first, second] = [await world.member([...WORKER_GRANTS, grant('report_error')]), await world.member([...WORKER_GRANTS, grant('report_error')])];
    const spec: FlowSpec = {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'first', type: 'TASK', extra: { assignmentMode: 'USERS', slaValue: 8, slaUnit: 'BUSINESS_HOURS' }, candidates: [user(first)] },
        { key: 'second', type: 'TASK', extra: { assignmentMode: 'USERS', slaValue: 8, slaUnit: 'BUSINESS_HOURS' }, candidates: [user(second)] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'first', type: 'DEFAULT' },
        { from: 'first', to: 'second', type: 'DECISION', label: 'Next' },
        { from: 'second', to: 'end', type: 'DECISION', label: 'Finish' },
      ],
    };
    flow = await publishFlow(world.admin, spec);
    types.record = await errorType({});
    types.process = await errorType({ process: true });
    types.forced = await errorType({ forcesClose: true });
    types.reopening = await errorType({ reopening: true });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('only records an error that is not a process error, attributed to whoever delivered the previous step', async () => {
    const ticket = await atSecondStep();
    const answer = (await report(second, ticket, types.record).expect(200)).body;
    expect(answer).toMatchObject({ status: 'OPEN', currentStepId: flow.step.second, openVisitId: ticket.visitId });
    expect(await errorsOf(ticket.id)).toEqual([{ reporter_id: second.userId, responsible_id: first.userId, is_process_error: false }]);
    expect((await world.events(ticket.id)).at(-1)).toMatchObject({ type: 'ERROR_REPORTED', actor_id: second.userId });
    expect(await world.assignees(ticket.id)).toEqual([{ user_id: second.userId, type: 'PRIMARY' }]);
  });

  it('sends a process error back to the previous step and its holder, in a new visit', async () => {
    const ticket = await atSecondStep();
    const answer = (await report(second, ticket, types.process).expect(200)).body;
    expect(answer).toMatchObject({ status: 'OPEN', currentStepId: flow.step.first });
    expect(await world.assignees(ticket.id)).toEqual([{ user_id: first.userId, type: 'PRIMARY' }]);
    const visits = await world.visits(ticket.id);
    expect(visits.map((visit) => [visit.step_id, visit.exited_at !== null])).toEqual([[flow.step.first, true], [flow.step.second, true], [flow.step.first, false]]);
    expect((await world.events(ticket.id)).find((event) => event.type === 'ERROR_REPORTED')!.data).toMatchObject({ outcome: 'RETURN', returnedToStepId: flow.step.first, responsibleId: first.userId });
  });

  it('closes on a process error at the first step (nobody but the creator before), and on a type that forces the close', async () => {
    const atFirst = await create();
    expect((await report(first, { id: atFirst.id, visitId: atFirst.openVisitId }, types.process).expect(200)).body).toMatchObject({ status: 'CLOSED' });
    expect(await errorsOf(atFirst.id)).toEqual([{ reporter_id: first.userId, responsible_id: requester.userId, is_process_error: true }]);
    expect(await closedState(atFirst.id)).toEqual({ status: 'CLOSED', forced_close: false });

    const forced = await atSecondStep();
    expect((await report(second, forced, types.forced).expect(200)).body).toMatchObject({ status: 'CLOSED' });
    expect((await errorsOf(forced.id))[0]).toMatchObject({ responsible_id: requester.userId });
    expect(await closedState(forced.id)).toEqual({ status: 'CLOSED', forced_close: true });
  });

  it('refuses a reopening type, a stale visit and someone without the permission', async () => {
    const ticket = await atSecondStep();
    expect((await report(second, ticket, types.reopening).expect(422)).body.error.code).toBe('INVALID_ERROR_TYPE');
    expect((await report(second, { id: ticket.id, visitId: (await create()).openVisitId }, types.record).expect(409)).body.error.code).toBe('STALE_TICKET');
    const outsider = await world.member([grant('read_all')]);
    await report(outsider, ticket, types.record).expect(403);
  });

  it('lists the tickets in the new inboxes: errors reported and received, reopened and history', async () => {
    const ticket = await atSecondStep();
    await report(second, ticket, types.record).expect(200);
    const ids = async (as: Member, view: string) => ((await as.client.get(`/tickets?view=${view}&pageSize=100`).expect(200)).body.items as Array<{ id: string }>).map((item) => item.id);
    expect(await ids(second, 'errors_reported')).toContain(ticket.id);
    expect(await ids(first, 'errors_received')).toContain(ticket.id);
    expect(await ids(first, 'errors_reported')).not.toContain(ticket.id);
    expect(await ids(first, 'history')).toContain(ticket.id);
    const counts = (await first.client.get('/tickets/counts').expect(200)).body;
    expect(Object.keys(counts).sort()).toEqual(['all', 'assigned', 'created', 'errors_received', 'errors_reported', 'history', 'observed', 'reopened']);
    expect(counts.errors_received).toBeGreaterThan(0);
  });
});

import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, type PublishedFlow, publishVersion, REQUESTER_GRANTS, SUPERVISOR_GRANTS, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

describe('ticket integrity: concurrency, closing and version pinning', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let twoSteps: PublishedFlow;
  let closable: PublishedFlow;

  const create = (flow: PublishedFlow, values: Record<string, unknown> = {}, as = requester) => as.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Request', values });
  const move = (as: Member, ticketId: string, transitionId: string, visitId: string, body: Record<string, unknown> = {}) => as.client.post(`/tickets/${ticketId}/transition`, { transitionId, visitId, ...body });

  /** START → first (worker) → second (worker) → END, plus a decision that loops `first` onto itself. */
  const twoStepSpec = (): FlowSpec => ({
    steps: [
      { key: 'start', type: 'START' },
      { key: 'first', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [user(worker)] },
      { key: 'second', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [user(worker)] },
      { key: 'end', type: 'END' },
    ],
    transitions: [
      { from: 'start', to: 'first', type: 'DEFAULT' },
      { from: 'first', to: 'second', type: 'DECISION', label: 'Next' },
      { from: 'first', to: 'first', type: 'DECISION', label: 'Again' },
      { from: 'second', to: 'end', type: 'DECISION', label: 'Finish' },
    ],
  });

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    [requester, worker] = [await world.member(REQUESTER_GRANTS), await world.member(WORKER_GRANTS)];
    twoSteps = await publishFlow(world.admin, twoStepSpec());
    closable = await publishFlow(world.admin, {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'work', type: 'TASK', extra: { assignmentMode: 'USERS', closeRule: 'ALLOWED', slaValue: 4, slaUnit: 'BUSINESS_HOURS' }, candidates: [user(worker)] },
        { key: 'locked', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [user(worker)] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'work', type: 'DEFAULT' },
        { from: 'work', to: 'locked', type: 'DECISION', label: 'Lock' },
        { from: 'work', to: 'end', type: 'DECISION', label: 'Finish' },
        { from: 'locked', to: 'end', type: 'DECISION', label: 'Done' },
      ],
      fields: [{ step: 'work', code: 'RESOLUTION', type: 'TEXT', capture: 'STEP', isRequired: true }],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('two simultaneous actions on the same ticket: only one wins', () => {
    it('two transitions with the same visit: one 200, one 409, exactly one new visit (10 rounds)', async () => {
      for (let round = 0; round < 10; round += 1) {
        const created = await create(twoSteps).expect(201);
        const attempts = await Promise.all([move(worker, created.body.id, twoSteps.transition.Next!, created.body.openVisitId), move(worker, created.body.id, twoSteps.transition.Next!, created.body.openVisitId)]);
        expect(attempts.map((attempt) => attempt.status).sort(), `round ${round}: ${JSON.stringify(attempts.map((attempt) => attempt.body))}`).toEqual([200, 409]);
        expect(attempts.find((attempt) => attempt.status === 409)!.body.error.code).toBe('STALE_TICKET');

        const visits = await world.visits(created.body.id);
        expect(visits.map((visit) => [visit.step_id, visit.exited_at !== null])).toEqual([[twoSteps.step.first, true], [twoSteps.step.second, false]]);
        expect((await world.events(created.body.id)).filter((event) => event.type === 'TRANSITIONED' && event.actor_id !== null)).toHaveLength(1);
        expect((await world.clocks(created.body.id)).filter((clock) => clock.completed_at === null)).toHaveLength(1);
        expect(await world.assignees(created.body.id)).toHaveLength(1);
      }
    });

    it('answers 503 with a retry hint, and writes nothing, when the ticket stays locked past the lock timeout', async () => {
      const created = await create(twoSteps).expect(201);
      const holder = await db.platform.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM tickets WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [world.tenant.tenantId, created.body.id]);
        const blocked = await move(worker, created.body.id, twoSteps.transition.Next!, created.body.openVisitId);
        expect(blocked.status).toBe(503);
        expect(blocked.body.error.code).toBe('TEMPORARILY_UNAVAILABLE');
        expect(blocked.headers['retry-after']).toBe('1');
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
      }
      expect((await world.visits(created.body.id)).map((visit) => visit.exited_at)).toEqual([null]);
      // The same request, repeated once the lock is gone, succeeds: that is what "try again" promises.
      await move(worker, created.body.id, twoSteps.transition.Next!, created.body.openVisitId).expect(200);
    }, 40_000);

    it('a transition that loops onto its own step does not apply twice either', async () => {
      const created = await create(twoSteps).expect(201);
      const attempts = await Promise.all([move(worker, created.body.id, twoSteps.transition.Again!, created.body.openVisitId), move(worker, created.body.id, twoSteps.transition.Again!, created.body.openVisitId)]);
      expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 409]);
      expect((await world.visits(created.body.id)).map((visit) => visit.loop)).toEqual([1, 2]);
      expect(await world.ticketRow(created.body.id)).toMatchObject({ current_loop: 2 });
    });

    it('a stale visit id is refused even when nobody races (the caller looked at an old screen)', async () => {
      const created = await create(twoSteps).expect(201);
      await move(worker, created.body.id, twoSteps.transition.Again!, created.body.openVisitId).expect(200);
      expect((await move(worker, created.body.id, twoSteps.transition.Again!, created.body.openVisitId).expect(409)).body.error.code).toBe('STALE_TICKET');
    });

    it('creates numbered 20 at a time get distinct numbers without gaps', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => create(twoSteps)));
      expect(results.map((result) => result.status)).toEqual(Array(20).fill(201));
      const numbers = results.map((result) => Number(result.body.number)).sort((a, b) => a - b);
      expect(numbers.at(-1)! - numbers[0]! + 1).toBe(20);
      expect(new Set(numbers).size).toBe(20);
    });
  });

  describe('closing', () => {
    it('closes from a step that allows it, finishing the visit and the clock', async () => {
      const created = await create(closable).expect(201);
      const closed = await worker.client.post(`/tickets/${created.body.id}/close`, { visitId: created.body.openVisitId, values: { RESOLUTION: 'Solved by phone' }, comment: 'Done' }).expect(200);
      expect(closed.body).toMatchObject({ status: 'CLOSED', openVisitId: null, currentStepId: closable.step.work });
      expect(await world.ticketRow(created.body.id)).toMatchObject({ status: 'CLOSED', closed_by_id: worker.userId });
      expect((await world.ticketRow(created.body.id)).closed_at).not.toBeNull();
      const [visit] = await world.visits(created.body.id);
      expect(visit).toMatchObject({ exit_transition_id: null });
      expect(visit!.exited_at).not.toBeNull();
      expect((await world.clocks(created.body.id))[0]!.completed_at).not.toBeNull();
      expect(await world.assignees(created.body.id)).toEqual([]);
      expect((await world.events(created.body.id)).map((event) => event.type)).toEqual(['CREATED', 'TRANSITIONED', 'ASSIGNED', 'FIELDS_UPDATED', 'CLOSED']);
      expect(await world.outbox('ticket.closed', created.body.id)).toHaveLength(1);
      expect((await move(worker, created.body.id, closable.transition.Finish!, created.body.openVisitId).expect(422)).body.error.code).toBe('TICKET_NOT_OPEN');
    });

    it('validates the step\'s required fields', async () => {
      const created = await create(closable).expect(201);
      const refused = await worker.client.post(`/tickets/${created.body.id}/close`, { visitId: created.body.openVisitId }).expect(422);
      expect(refused.body.error.details.issues[0]).toMatchObject({ code: 'REQUIRED', fieldCode: 'RESOLUTION' });
      expect((await world.ticketRow(created.body.id)).status).toBe('OPEN');
    });

    it('a step that does not allow closing refuses (422)', async () => {
      const created = await create(closable).expect(201);
      const locked = await move(worker, created.body.id, closable.transition.Lock!, created.body.openVisitId, { values: { RESOLUTION: 'x' } }).expect(200);
      const refused = await worker.client.post(`/tickets/${created.body.id}/close`, { visitId: locked.body.openVisitId }).expect(422);
      expect(refused.body.error.code).toBe('CLOSE_NOT_ALLOWED');
    });

    it('only an assignee closes, and the close permission is needed', async () => {
      const created = await create(closable).expect(201);
      const reader = await world.member([...SUPERVISOR_GRANTS.filter((grant) => grant.action === 'read_all'), { action: 'close', subject: 'Ticket' }]);
      expect((await reader.client.post(`/tickets/${created.body.id}/close`, { visitId: created.body.openVisitId, values: { RESOLUTION: 'x' } })).status).toBe(403);
      expect((await requester.client.post(`/tickets/${created.body.id}/close`, { visitId: created.body.openVisitId, values: { RESOLUTION: 'x' } })).status).toBe(403);
    });

    it('a rule the database checks only at COMMIT (pending parallel task) is a 422, and nothing is closed', async () => {
      const created = await create(closable).expect(201);
      await db.platform.query(`INSERT INTO ticket_parallel_tasks (tenant_id, ticket_id, step_id, user_id) VALUES ($1, $2, $3, $4)`, [world.tenant.tenantId, created.body.id, closable.step.work, worker.userId]);
      const refused = await worker.client.post(`/tickets/${created.body.id}/close`, { visitId: created.body.openVisitId, values: { RESOLUTION: 'x' } });
      expect([refused.status, refused.body.error.code]).toEqual([422, 'INVALID_STATE']);
      expect(await world.ticketRow(created.body.id)).toMatchObject({ status: 'OPEN', closed_at: null });
      expect((await world.visits(created.body.id))[0]!.exited_at).toBeNull();
    });
  });

  describe('a ticket stays on the version it was created with', () => {
    it('keeps its transitions after a new version is published; new tickets use the new one', async () => {
      const flow = await publishFlow(world.admin, twoStepSpec());
      const old = await create(flow).expect(201);

      const draft = (await world.admin.post(`/workflows/${flow.workflowId}/versions`, {}).expect(201)).body.id as string;
      const next = await publishVersion(world.admin, flow.workflowId, draft, {
        steps: [{ key: 'start', type: 'START' }, { key: 'only', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [user(worker)] }, { key: 'end', type: 'END' }],
        transitions: [{ from: 'start', to: 'only', type: 'DEFAULT' }, { from: 'only', to: 'end', type: 'DECISION', label: 'Finish' }],
      });
      expect((await db.platform.query(`SELECT status FROM workflow_versions WHERE id = $1`, [flow.versionId])).rows[0].status).toBe('ARCHIVED');

      const fresh = await create(flow).expect(201);
      expect(await world.ticketRow(fresh.body.id)).toMatchObject({ workflow_version_id: draft, current_step_id: next.step.only });
      expect(await world.ticketRow(old.body.id)).toMatchObject({ workflow_version_id: flow.versionId });

      // The old ticket keeps moving on version 1; version 2's transitions do not exist for it.
      expect((await move(worker, old.body.id, next.transition.Finish!, old.body.openVisitId).expect(422)).body.error.code).toBe('INVALID_TRANSITION');
      const advanced = await move(worker, old.body.id, flow.transition.Next!, old.body.openVisitId).expect(200);
      expect(advanced.body.currentStepId).toBe(flow.step.second);
      const finished = await move(worker, old.body.id, flow.transition.Finish!, advanced.body.openVisitId).expect(200);
      expect(finished.body.status).toBe('CLOSED');
      expect(await world.ticketRow(old.body.id)).toMatchObject({ workflow_version_id: flow.versionId });
    });
  });
});

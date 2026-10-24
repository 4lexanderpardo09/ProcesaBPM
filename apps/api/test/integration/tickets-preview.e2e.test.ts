import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

describe('previews of where a ticket goes: before creating it and before answering a step', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let [first, second, third]: Member[] = [];

  const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });
  const count = async () => Number((await db.platform.query(`SELECT count(*)::int AS n FROM tickets WHERE tenant_id = $1`, [world.tenant.tenantId])).rows[0].n);
  const creationPreview = (flow: PublishedFlow, values: Record<string, unknown> = {}) => requester.client.post('/tickets/creation-preview', { subcategoryId: flow.subcategoryId, values });
  const ids = (people: ReadonlyArray<{ id: string }>) => people.map((person) => person.id).sort();

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member(REQUESTER_GRANTS);
    [first, second, third] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('before creating', () => {
    it('a manual-selection step with several candidates asks to choose among them, and nothing is created', async () => {
      const flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS', manualSelection: true }, { candidates: [user(first!), user(second!)] }));
      const before = await count();
      const preview = (await creationPreview(flow).expect(200)).body;
      expect(preview).toMatchObject({ outcome: 'STEP', step: { id: flow.step.task, type: 'TASK' }, assignment: 'CHOOSE', blocked: null });
      expect(ids(preview.people)).toEqual([first!.userId, second!.userId].sort());
      expect(await count()).toBe(before);
    });

    it('several candidates without manual selection are a pool; one candidate is the person', async () => {
      const pool = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(first!), user(second!)] }));
      expect((await creationPreview(pool).expect(200)).body.assignment).toBe('POOL');
      const single = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS', manualSelection: true }, { candidates: [user(third!)] }));
      expect((await creationPreview(single).expect(200)).body).toMatchObject({ assignment: 'PERSON', people: [{ id: third!.userId }] });
    });

    it('a random dispatch names who it is handed out among', async () => {
      const flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'RANDOM_DISPATCH', dispatchIntervalMin: 5 }, { candidates: [user(first!), user(second!)] }));
      const preview = (await creationPreview(flow).expect(200)).body;
      expect(preview.assignment).toBe('DISPATCH');
      expect(ids(preview.people)).toEqual([first!.userId, second!.userId].sort());
    });

    it('a step nobody can get is blocked with the error the creation would get', async () => {
      const group = await world.group([]);
      const flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'GROUP' }, { candidates: [{ participantType: 'GROUP', groupId: group }] }));
      expect((await creationPreview(flow).expect(200)).body).toMatchObject({ outcome: 'BLOCKED', blocked: { code: 'NO_ASSIGNEE_CANDIDATES' }, step: null });
    });

    it('follows the conditions with the values typed so far, ignoring the ones that are not valid yet', async () => {
      const flow = await publishFlow(world.admin, {
        steps: [
          { key: 'start', type: 'START' },
          { key: 'amount', type: 'CONDITION' },
          { key: 'directors', type: 'TASK', name: 'Directors', extra: { assignmentMode: 'USERS' }, candidates: [user(first!)] },
          { key: 'end', type: 'END' },
        ],
        transitions: [
          { from: 'start', to: 'amount', type: 'DEFAULT' },
          { from: 'amount', to: 'directors', type: 'CONDITION', label: 'Big', condition: [{ field: 'AMOUNT', op: 'gt', value: 1000 }] },
          { from: 'amount', to: 'end', type: 'DEFAULT', label: 'Small' },
          { from: 'directors', to: 'end', type: 'DECISION', label: 'Sign off' },
        ],
        fields: [{ step: 'start', code: 'AMOUNT', type: 'CURRENCY', capture: 'CREATION', isRequired: true }],
      });
      expect((await creationPreview(flow, { AMOUNT: 5000 }).expect(200)).body).toMatchObject({ outcome: 'STEP', step: { name: 'Directors' }, via: [{ blockType: 'CONDITION' }] });
      expect((await creationPreview(flow, { AMOUNT: 10 }).expect(200)).body).toMatchObject({ outcome: 'END', step: null });
      expect((await creationPreview(flow, { AMOUNT: 'not a number' }).expect(200)).body.outcome).toBe('END');
    });

    it('asks the same as creating: who may not create gets the same refusal', async () => {
      const flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(first!)] }));
      expect((await world.member([]).then((nobody) => nobody.client.post('/tickets/creation-preview', { subcategoryId: flow.subcategoryId }))).status).toBe(403);
    });
  });

  describe('before answering a step', () => {
    it('names the next step, who chooses and the fields filled there; a parallel step lists its signers; the end says so', async () => {
      const flow = await publishFlow(world.admin, {
        steps: [
          { key: 'start', type: 'START' },
          { key: 'review', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [user(first!)] },
          { key: 'work', type: 'TASK', name: 'Work', extra: { assignmentMode: 'USERS', manualSelection: true }, candidates: [user(second!), user(third!)] },
          { key: 'sign', type: 'TASK', extra: { assignmentMode: 'PARALLEL' }, signers: [{ signerType: 'USER', userId: second!.userId }, { signerType: 'USER', userId: third!.userId }] },
          { key: 'end', type: 'END' },
        ],
        transitions: [
          { from: 'start', to: 'review', type: 'DEFAULT' },
          { from: 'review', to: 'work', type: 'DECISION', label: 'Assign' },
          { from: 'review', to: 'sign', type: 'DECISION', label: 'Sign' },
          { from: 'review', to: 'end', type: 'DECISION', label: 'Finish' },
          { from: 'work', to: 'end', type: 'DECISION', label: 'Done' },
          { from: 'sign', to: 'end', type: 'DECISION', label: 'Signed' },
        ],
        fields: [{ step: 'work', code: 'RESULT', type: 'TEXT', capture: 'STEP' }],
      });
      const ticket = (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Request', values: {} }).expect(201)).body;
      const preview = (transitionId: string | undefined) => first!.client.post(`/tickets/${ticket.id}/transition-preview`, { transitionId, visitId: ticket.openVisitId, values: {} });

      const assign = (await preview(flow.transition.Assign).expect(200)).body;
      expect(assign).toMatchObject({ outcome: 'STEP', step: { name: 'Work' }, assignment: 'CHOOSE', fields: ['RESULT'] });
      expect(ids(assign.people)).toEqual([second!.userId, third!.userId].sort());
      const sign = (await preview(flow.transition.Sign).expect(200)).body;
      expect(sign.assignment).toBe('PARALLEL');
      expect(ids(sign.people)).toEqual([second!.userId, third!.userId].sort());
      expect((await preview(flow.transition.Finish).expect(200)).body).toMatchObject({ outcome: 'END', assignment: null, people: [] });
      expect((await preview(flow.transition.Done).expect(422)).body.error.code).toBe('INVALID_TRANSITION');

      // Nothing changed: the ticket is still on the review step and can be answered.
      expect((await world.ticketRow(ticket.id)).current_step_id).toBe(flow.step.review);
      await first!.client.post(`/tickets/${ticket.id}/transition`, { transitionId: flow.transition.Assign, visitId: ticket.openVisitId, assigneeId: third!.userId }).expect(200);
    });

    it('only who may answer the step may preview it', async () => {
      const flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(first!)] }));
      const ticket = (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Request', values: {} }).expect(201)).body;
      const refused = await second!.client.post(`/tickets/${ticket.id}/transition-preview`, { transitionId: flow.transition.Done, visitId: ticket.openVisitId });
      expect([403, 404]).toContain(refused.status);
    });
  });
});

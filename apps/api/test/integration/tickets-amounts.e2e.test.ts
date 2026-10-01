import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

describe('amount rules: block, warn and extra approval', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let boss: Member;
  let atCreation: PublishedFlow;
  let atStep: PublishedFlow;

  const count = async () => Number((await db.platform.query(`SELECT count(*)::int AS n FROM tickets WHERE tenant_id = $1`, [world.tenant.tenantId])).rows[0].n);
  const create = (flow: PublishedFlow, values: Record<string, unknown>) => requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Request', values });
  const move = (as: Member, ticketId: string, transitionId: string, visitId: string, values: Record<string, unknown> = {}) =>
    as.client.post(`/tickets/${ticketId}/transition`, { transitionId, visitId, values });
  const toUsers = (member: Member) => ({ extra: { assignmentMode: 'USERS' }, candidates: [{ participantType: 'USER', userId: member.userId }] });

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    [requester, worker, boss] = [await world.member(REQUESTER_GRANTS), await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];

    atCreation = await publishFlow(world.admin, {
      steps: [{ key: 'start', type: 'START' }, { key: 'task', type: 'TASK', ...toUsers(worker) }, { key: 'extra', type: 'APPROVAL', ...toUsers(boss) }, { key: 'end', type: 'END' }],
      transitions: [
        { from: 'start', to: 'task', type: 'DEFAULT' },
        { from: 'start', to: 'extra', type: 'SYSTEM_ONLY', label: 'Over the limit' },
        { from: 'task', to: 'end', type: 'DECISION', label: 'Done' },
        { from: 'extra', to: 'task', type: 'DECISION', label: 'Authorize' },
      ],
      fields: [{ step: 'start', code: 'AMOUNT', type: 'CURRENCY', capture: 'CREATION' }],
      rules: [
        { step: 'start', fieldCode: 'AMOUNT', maxAmount: '100000.00', action: 'BLOCK', message: 'Over the absolute limit' },
        { step: 'start', fieldCode: 'AMOUNT', maxAmount: '3000.00', action: 'WARN', message: 'Check this amount' },
        { step: 'start', fieldCode: 'AMOUNT', maxAmount: '5000.00', action: 'EXTRA_APPROVAL', approvalStep: 'extra' },
      ],
    });

    atStep = await publishFlow(world.admin, {
      steps: [{ key: 'start', type: 'START' }, { key: 'task', type: 'TASK', ...toUsers(worker) }, { key: 'extra', type: 'APPROVAL', ...toUsers(boss) }, { key: 'end', type: 'END' }],
      transitions: [
        { from: 'start', to: 'task', type: 'DEFAULT' },
        { from: 'task', to: 'end', type: 'DECISION', label: 'Done' },
        { from: 'task', to: 'extra', type: 'SYSTEM_ONLY', label: 'Over the limit' },
        { from: 'extra', to: 'task', type: 'DECISION', label: 'Authorize' },
      ],
      fields: [{ step: 'task', code: 'SPENT', type: 'CURRENCY', capture: 'STEP' }],
      rules: [
        { step: 'task', fieldCode: 'SPENT', maxAmount: '100000.00', action: 'BLOCK', message: 'Cannot spend that much' },
        { step: 'task', fieldCode: 'SPENT', maxAmount: '5000.00', action: 'EXTRA_APPROVAL', approvalStep: 'extra' },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('when the ticket is created', () => {
    it('BLOCK refuses with the rule message and creates nothing', async () => {
      const before = await count();
      const refused = await create(atCreation, { AMOUNT: 100000.01 }).expect(422);
      expect(refused.body.error).toMatchObject({ code: 'AMOUNT_LIMIT_EXCEEDED', details: { messages: ['Over the absolute limit'] } });
      expect(await count()).toBe(before);
    });

    it('the cap itself is allowed', async () => {
      await create(atCreation, { AMOUNT: 100000 }).expect(201);
    });

    it('WARN lets the ticket in and records an AMOUNT_WARNING event', async () => {
      const created = await create(atCreation, { AMOUNT: '4000' }).expect(201);
      expect(created.body.currentStepId).toBe(atCreation.step.task);
      const warning = (await world.events(created.body.id)).find((event) => event.type === 'AMOUNT_WARNING');
      expect(warning?.data).toMatchObject({ amount: '4000.00', max: '3000.00', message: 'Check this amount' });
    });

    it('EXTRA_APPROVAL sends the ticket through the SYSTEM_ONLY edge to the approval step', async () => {
      const created = await create(atCreation, { AMOUNT: 6000 }).expect(201);
      expect(created.body.currentStepId).toBe(atCreation.step.extra);
      expect(await world.assignees(created.body.id)).toEqual([{ user_id: boss.userId, type: 'PRIMARY' }]);
      const hop = (await world.events(created.body.id)).find((event) => event.type === 'TRANSITIONED');
      expect(hop).toMatchObject({ transition_id: atCreation.transition['Over the limit'], data: { automatic: true, blockType: 'START' } });
      expect((await world.events(created.body.id)).some((event) => event.type === 'AMOUNT_WARNING')).toBe(true);
    });

    it('a small amount takes the normal path', async () => {
      const created = await create(atCreation, { AMOUNT: 10 }).expect(201);
      expect(created.body.currentStepId).toBe(atCreation.step.task);
      expect((await world.events(created.body.id)).some((event) => event.type === 'AMOUNT_WARNING')).toBe(false);
    });
  });

  describe('when a step is answered', () => {
    it('BLOCK refuses the transition and leaves the ticket as it was', async () => {
      const created = await create(atStep, {}).expect(201);
      const refused = await move(worker, created.body.id, atStep.transition.Done!, created.body.openVisitId, { SPENT: 200000 }).expect(422);
      expect(refused.body.error).toMatchObject({ code: 'AMOUNT_LIMIT_EXCEEDED', details: { messages: ['Cannot spend that much'] } });
      expect(await world.ticketRow(created.body.id)).toMatchObject({ status: 'OPEN', current_step_id: atStep.step.task });
      expect((await world.visits(created.body.id)).every((visit) => visit.exited_at === null)).toBe(true);
    });

    it('EXTRA_APPROVAL diverts the chosen transition, keeps it in the event, and does not divert twice', async () => {
      const created = await create(atStep, {}).expect(201);
      const diverted = await move(worker, created.body.id, atStep.transition.Done!, created.body.openVisitId, { SPENT: 6000 }).expect(200);
      expect(diverted.body).toMatchObject({ status: 'OPEN', currentStepId: atStep.step.extra });
      const transitioned = (await world.events(created.body.id)).filter((event) => event.type === 'TRANSITIONED').at(-1)!;
      expect(transitioned).toMatchObject({ transition_id: atStep.transition['Over the limit'], data: { intendedTransitionId: atStep.transition.Done } });
      expect(await world.assignees(created.body.id)).toEqual([{ user_id: boss.userId, type: 'PRIMARY' }]);

      const authorized = await move(boss, created.body.id, atStep.transition.Authorize!, diverted.body.openVisitId).expect(200);
      expect(authorized.body.currentStepId).toBe(atStep.step.task);
      expect((await world.visits(created.body.id)).filter((visit) => visit.step_id === atStep.step.task).map((visit) => visit.loop)).toEqual([1, 2]);

      // The stored 6000 still exceeds the cap, but the ticket already went through the extra approval.
      const done = await move(worker, created.body.id, atStep.transition.Done!, authorized.body.openVisitId).expect(200);
      expect(done.body.status).toBe('CLOSED');
    });

    it('stores the values it accepted and records what changed', async () => {
      const created = await create(atStep, {}).expect(201);
      await move(worker, created.body.id, atStep.transition.Done!, created.body.openVisitId, { SPENT: '1200.5' }).expect(200);
      expect((await db.platform.query(`SELECT value FROM ticket_field_values WHERE ticket_id = $1`, [created.body.id])).rows).toEqual([{ value: 1200.5 }]);
      const updated = (await world.events(created.body.id)).find((event) => event.type === 'FIELDS_UPDATED');
      expect(updated?.data).toEqual({ changes: [{ code: 'SPENT', before: null, after: 1200.5 }] });
    });
  });
});

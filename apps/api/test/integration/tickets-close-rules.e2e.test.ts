import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

describe('close_rule REQUIRED and closing past an extra approval', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let boss: Member;
  let required: PublishedFlow;
  let capped: PublishedFlow;

  const create = (flow: PublishedFlow, values: Record<string, unknown> = {}) => requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Request', values });
  const close = (ticket: { id: string; openVisitId: string }, values: Record<string, unknown> = {}) => worker.client.post(`/tickets/${ticket.id}/close`, { visitId: ticket.openVisitId, values });

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    [requester, worker, boss] = [await world.member(REQUESTER_GRANTS), await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];

    required = await publishFlow(world.admin, {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'work', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [user(worker)] },
        { key: 'closer', type: 'TASK', extra: { assignmentMode: 'USERS', closeRule: 'REQUIRED' }, candidates: [user(worker)] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'work', type: 'DEFAULT' },
        { from: 'work', to: 'end', type: 'DECISION', label: 'Finish' },
        { from: 'work', to: 'closer', type: 'DECISION', label: 'Escalate' },
      ],
    });
    capped = await publishFlow(world.admin, {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'work', type: 'TASK', extra: { assignmentMode: 'USERS', closeRule: 'ALLOWED' }, candidates: [user(worker)] },
        { key: 'extra', type: 'APPROVAL', extra: { assignmentMode: 'USERS' }, candidates: [user(boss)] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'work', type: 'DEFAULT' },
        { from: 'work', to: 'end', type: 'DECISION', label: 'Finish' },
        { from: 'work', to: 'extra', type: 'SYSTEM_ONLY', label: 'Over' },
        { from: 'extra', to: 'work', type: 'DECISION', label: 'Authorize' },
      ],
      fields: [{ step: 'work', code: 'SPENT', type: 'CURRENCY', capture: 'STEP' }],
      rules: [
        { step: 'work', fieldCode: 'SPENT', maxAmount: '1000.00', action: 'WARN', message: 'High' },
        { step: 'work', fieldCode: 'SPENT', maxAmount: '5000.00', action: 'EXTRA_APPROVAL', approvalStep: 'extra' },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('REQUIRED', () => {
    it('a step that must close is reached by a decision and left only by closing', async () => {
      const created = await create(required).expect(201);
      const escalated = await worker.client.post(`/tickets/${created.body.id}/transition`, { transitionId: required.transition.Escalate, visitId: created.body.openVisitId }).expect(200);
      expect(escalated.body.currentStepId).toBe(required.step.closer);
      const closed = await close(escalated.body).expect(200);
      expect(closed.body.status).toBe('CLOSED');
    });

    it('a decision out of it is refused (422 CLOSE_REQUIRED) even if an older version still has one', async () => {
      const flow = await publishFlow(world.admin, {
        steps: [{ key: 'start', type: 'START' }, { key: 'work', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [user(worker)] }, { key: 'end', type: 'END' }],
        transitions: [{ from: 'start', to: 'work', type: 'DEFAULT' }, { from: 'work', to: 'end', type: 'DECISION', label: 'Finish' }],
      });
      // Published versions are immutable: simulate one published before the validator knew REQUIRED steps have no exits.
      await db.owner.query(`ALTER TABLE steps DISABLE TRIGGER USER`);
      try {
        await db.owner.query(`UPDATE steps SET close_rule = 'REQUIRED' WHERE tenant_id = $1 AND id = $2`, [world.tenant.tenantId, flow.step.work]);
      } finally {
        await db.owner.query(`ALTER TABLE steps ENABLE TRIGGER USER`);
      }
      const created = await create(flow).expect(201);
      const refused = await worker.client.post(`/tickets/${created.body.id}/transition`, { transitionId: flow.transition.Finish, visitId: created.body.openVisitId });
      expect([refused.status, refused.body.error.code]).toEqual([422, 'CLOSE_REQUIRED']);
    });
  });

  describe('closing and amount caps', () => {
    it('records the warning when the closing amount passes a WARN cap', async () => {
      const created = await create(capped).expect(201);
      await close(created.body, { SPENT: 2000 }).expect(200);
      expect((await world.events(created.body.id)).filter((event) => event.type === 'AMOUNT_WARNING')).toHaveLength(1);
    });

    it('refuses to close past an extra approval, and closes once the ticket went through it', async () => {
      const created = await create(capped).expect(201);
      const refused = await close(created.body, { SPENT: 6000 });
      expect([refused.status, refused.body.error.code]).toEqual([422, 'EXTRA_APPROVAL_REQUIRED']);
      expect((await world.ticketRow(created.body.id)).status).toBe('OPEN');

      const diverted = await worker.client.post(`/tickets/${created.body.id}/transition`, { transitionId: capped.transition.Finish, visitId: created.body.openVisitId, values: { SPENT: 6000 } }).expect(200);
      expect(diverted.body.currentStepId).toBe(capped.step.extra);
      const authorized = await boss.client.post(`/tickets/${created.body.id}/transition`, { transitionId: capped.transition.Authorize, visitId: diverted.body.openVisitId }).expect(200);
      expect((await close(authorized.body)).status).toBe(200);
    });
  });
});

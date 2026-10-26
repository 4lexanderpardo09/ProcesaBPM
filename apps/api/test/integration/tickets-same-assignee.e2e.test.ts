import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

describe('a step for the same person who delivered an earlier one', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let second: Member;
  let flow: PublishedFlow;

  /** START -> review (pool of two) -> check (the requester) -> settle (whoever delivered review) -> END. */
  const spec = (): FlowSpec => ({
    steps: [
      { key: 'start', type: 'START' },
      { key: 'review', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [user(worker), user(second)] },
      { key: 'check', type: 'APPROVAL' },
      { key: 'settle', type: 'TASK', extra: { assignmentMode: 'SAME_AS_STEP', sameAssigneeStepId: 'new:review' } },
      { key: 'end', type: 'END' },
    ],
    transitions: [
      { from: 'start', to: 'review', type: 'DEFAULT' },
      { from: 'review', to: 'check', type: 'DECISION', label: 'Reviewed' },
      { from: 'check', to: 'settle', type: 'DECISION', label: 'Checked' },
      { from: 'settle', to: 'end', type: 'DECISION', label: 'Settled' },
    ],
  });

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member([...REQUESTER_GRANTS, { action: 'transition', subject: 'Ticket' }, { action: 'read_assigned', subject: 'Ticket' }]);
    worker = await world.member(WORKER_GRANTS);
    second = await world.member(WORKER_GRANTS);
    flow = await publishFlow(world.admin, spec());
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('keeps the step it points to through the builder, as a real id', async () => {
    const document = (await world.admin.get(`/workflows/${flow.workflowId}/versions/${flow.versionId}`).expect(200)).body.document;
    const settle = document.steps.find((step: { id: string }) => step.id === flow.step.settle);
    expect(settle).toMatchObject({ assignmentMode: 'SAME_AS_STEP', sameAssigneeStepId: flow.step.review });
  });

  it('goes to whoever of the pool delivered the earlier step', async () => {
    const created = (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: unique('Refund'), values: {} }).expect(201)).body;
    const reviewed = (await second.client.post(`/tickets/${created.id}/transition`, { transitionId: flow.transition.Reviewed, visitId: created.openVisitId }).expect(200)).body;
    await requester.client.post(`/tickets/${created.id}/transition`, { transitionId: flow.transition.Checked, visitId: reviewed.openVisitId }).expect(200);

    expect((await world.ticketRow(created.id)).current_step_id).toBe(flow.step.settle);
    expect(await world.assignees(created.id)).toEqual([{ user_id: second.userId, type: 'PRIMARY' }]);
  });

  it('also works when the step it points to is the one being left (the help desk resolves it the same way)', async () => {
    const next = await publishFlow(world.admin, {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'review', type: 'TASK', extra: { assignmentMode: 'POOL' }, candidates: [user(worker), user(second)] },
        { key: 'settle', type: 'TASK', extra: { assignmentMode: 'SAME_AS_STEP', sameAssigneeStepId: 'new:review' } },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'review', type: 'DEFAULT' },
        { from: 'review', to: 'settle', type: 'DECISION', label: 'Reviewed' },
        { from: 'settle', to: 'end', type: 'DECISION', label: 'Settled' },
      ],
    });
    const created = (await requester.client.post('/tickets', { subcategoryId: next.subcategoryId, title: unique('Refund'), values: {} }).expect(201)).body;
    // Answering from the pool takes it implicitly: the step right after goes to that same person.
    await second.client.post(`/tickets/${created.id}/transition`, { transitionId: next.transition.Reviewed, visitId: created.openVisitId }).expect(200);

    expect((await world.ticketRow(created.id)).current_step_id).toBe(next.step.settle);
    expect(await world.assignees(created.id)).toEqual([{ user_id: second.userId, type: 'PRIMARY' }]);
  });

  it('refuses to publish a step that points to one the ticket cannot have visited before', async () => {
    const category = (await world.admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
    const subcategoryId = (await world.admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
    const workflow = (await world.admin.post('/workflows', { subcategoryId, name: unique('Flow') }).expect(201)).body;
    const base = `/workflows/${workflow.id}/versions/${workflow.versions[0].id}`;
    await world.admin
      .put(`${base}/graph`, {
        revision: 0,
        steps: [
          { id: 'new:start', type: 'START', name: 'start' },
          { id: 'new:first', type: 'TASK', name: 'first', assignmentMode: 'SAME_AS_STEP', sameAssigneeStepId: 'new:later' },
          { id: 'new:later', type: 'TASK', name: 'later', assignmentMode: 'CREATOR' },
          { id: 'new:end', type: 'END', name: 'end' },
        ],
        transitions: [
          { id: 'new:a', fromStepId: 'new:start', toStepId: 'new:first', type: 'DEFAULT', label: 'a', sortOrder: 0 },
          { id: 'new:b', fromStepId: 'new:first', toStepId: 'new:later', type: 'DECISION', label: 'b', sortOrder: 1 },
          { id: 'new:c', fromStepId: 'new:later', toStepId: 'new:end', type: 'DECISION', label: 'c', sortOrder: 2 },
        ],
      })
      .expect(200);
    const refused = await world.admin.post(`${base}/publish`, {});
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('SAME_STEP_NOT_BEFORE');
  });
});

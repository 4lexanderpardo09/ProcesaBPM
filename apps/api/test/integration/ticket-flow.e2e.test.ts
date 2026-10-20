import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { ticketFlowResponseSchema } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, type PublishedFlow, publishFlow, simpleFlow, TicketWorld, unique } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });

/** START → Review (the creator's) which can send it back to itself ("Back") or finish it ("Approve") → END. */
const loopFlow: FlowSpec = {
  steps: [
    { key: 'start', type: 'START', extra: { ui: { x: 0, y: 40 } } },
    { key: 'review', type: 'TASK', name: 'Review', extra: { ui: { x: 250, y: 40 }, description: 'not for the diagram', maxLoops: 5 } },
    { key: 'end', type: 'END', extra: { ui: { x: 500, y: 40 } } },
  ],
  transitions: [
    { from: 'start', to: 'review', type: 'DEFAULT' },
    { from: 'review', to: 'review', type: 'DECISION', label: 'Back', sortOrder: 2 },
    { from: 'review', to: 'end', type: 'DECISION', label: 'Approve', sortOrder: 1 },
  ],
  fields: [{ step: 'start', code: 'AMOUNT', type: 'NUMBER', capture: 'CREATION' }],
};

interface Flow {
  status: string;
  currentStepId: string | null;
  steps: Array<{ id: string; type: string; name: string; position: { x: number; y: number }; passCount: number }>;
  transitions: Array<{ id: string; fromStepId: string; toStepId: string; type: string; label: string; points: unknown; takenCount: number }>;
}

const passes = (flow: Flow) => Object.fromEntries(flow.steps.map((step) => [step.id, step.passCount]));
const taken = (flow: Flow) => Object.fromEntries(flow.transitions.map((transition) => [transition.id, transition.takenCount]));

describe('GET /tickets/:id/flow', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let member: Member;
  let colleague: Member;
  let flow: PublishedFlow;

  const getFlow = async (who: Member, ticketId: string): Promise<Flow> => ticketFlowResponseSchema.parse((await who.client.get(`/tickets/${ticketId}/flow`).expect(200)).body) as Flow;
  const create = async () => (await member.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: unique('T'), values: { AMOUNT: 5 } }).expect(201)).body as { id: string; openVisitId: string };
  const decide = async (ticketId: string, visitId: string, label: string) =>
    (await member.client.post(`/tickets/${ticketId}/transition`, { transitionId: flow.transition[label], visitId, values: {} }).expect(200)).body as { openVisitId: string | null; status: string };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    // Neither has any permission on Workflow: reading the ticket is what lets them see its diagram.
    member = await world.member([grant('create'), grant('read_created'), grant('transition')]);
    colleague = await world.member([grant('create'), grant('read_created')]);
    flow = await publishFlow(world.admin, loopFlow);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('draws the version with positions and only the diagram parts, and the progress of a new ticket', async () => {
    const ticket = await create();
    const body = (await member.client.get(`/tickets/${ticket.id}/flow`).expect(200)).body as Flow & Record<string, unknown>;
    expect(body).toMatchObject({ ticketId: ticket.id, versionId: flow.versionId, status: 'OPEN', currentStepId: flow.step.review });
    expect(body.steps).toEqual([
      { id: flow.step.start, type: 'START', name: 'start', position: { x: 0, y: 40 }, passCount: 1 },
      { id: flow.step.review, type: 'TASK', name: 'Review', position: { x: 250, y: 40 }, passCount: 1 },
      { id: flow.step.end, type: 'END', name: 'end', position: { x: 500, y: 40 }, passCount: 0 },
    ]);
    expect(body.transitions).toContainEqual({ id: flow.transition.Back, fromStepId: flow.step.review, toStepId: flow.step.review, type: 'DECISION', label: 'Back', points: null, takenCount: 0 });
    expect(taken(body)).toEqual({ [flow.transition['start->review']!]: 1, [flow.transition.Back!]: 0, [flow.transition.Approve!]: 0 });
    expect(JSON.stringify(body)).not.toMatch(/AMOUNT|not for the diagram|assignmentMode|candidates|condition/);
  });

  it('follows the ticket as it advances, counting a loop again, until it closes at the END', async () => {
    const ticket = await create();
    const back = await decide(ticket.id, ticket.openVisitId, 'Back');
    const looped = await getFlow(member, ticket.id);
    expect(looped.currentStepId).toBe(flow.step.review);
    expect(passes(looped)).toEqual({ [flow.step.start!]: 1, [flow.step.review!]: 2, [flow.step.end!]: 0 });
    expect(taken(looped)[flow.transition.Back!]).toBe(1);

    const again = await decide(ticket.id, back.openVisitId!, 'Back');
    expect(passes(await getFlow(member, ticket.id))[flow.step.review!]).toBe(3);

    expect((await decide(ticket.id, again.openVisitId!, 'Approve')).status).toBe('CLOSED');
    const closed = await getFlow(member, ticket.id);
    expect(closed).toMatchObject({ status: 'CLOSED', currentStepId: null });
    expect(passes(closed)).toEqual({ [flow.step.start!]: 1, [flow.step.review!]: 3, [flow.step.end!]: 1 });
    expect(taken(closed)).toEqual({ [flow.transition['start->review']!]: 1, [flow.transition.Back!]: 2, [flow.transition.Approve!]: 1 });
  });

  it('works without any permission on workflows, which the builder routes still require', async () => {
    const ticket = await create();
    await member.client.get(`/workflows/${flow.workflowId}/versions/${flow.versionId}`).expect(403);
    await member.client.get(`/tickets/${ticket.id}/flow`).expect(200);
  });

  it('a ticket the caller cannot read answers 404, like one that does not exist', async () => {
    const ticket = await create();
    await colleague.client.get(`/tickets/${ticket.id}/flow`).expect(404);
    await member.client.get('/tickets/0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90/flow').expect(404);
    await member.client.get('/tickets/not-a-uuid/flow').expect(400);
  });

  it('another tenant\'s ticket is 404 even for an administrator, and its diagram has only its own version', async () => {
    const foreign = await TicketWorld.create(db, app);
    const foreignFlow = await publishFlow(foreign.admin, simpleFlow());
    const foreignTicket = (await foreign.admin.post('/tickets', { subcategoryId: foreignFlow.subcategoryId, title: 'Foreign', values: {} }).expect(201)).body as { id: string };
    await world.admin.get(`/tickets/${foreignTicket.id}/flow`).expect(404);

    const own = (await foreign.admin.get(`/tickets/${foreignTicket.id}/flow`).expect(200)).body as Flow & { versionId: string };
    expect(own.versionId).toBe(foreignFlow.versionId);
    expect(own.steps.map((step) => step.id).sort()).toEqual(Object.values(foreignFlow.step).sort());
    const mine = await create();
    await foreign.admin.get(`/tickets/${mine.id}/flow`).expect(404);
  });
});

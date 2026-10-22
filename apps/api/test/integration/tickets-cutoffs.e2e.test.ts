import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, TicketWorld, unique } from '../support/ticket-world.js';

useTestEnvironment();

describe('company cutoffs: the CUTOFF deadline and the wait for the cutoff', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;

  /** START (with the DUE date) -> task due by cutoff, 3 business days -> END. */
  const deadlineFlow: FlowSpec = {
    steps: [
      { key: 'start', type: 'START' },
      { key: 'task', type: 'TASK', extra: { deadlineType: 'CUTOFF', deadlineFieldCode: 'DUE', deadlineBusinessDays: 3 } },
      { key: 'end', type: 'END' },
    ],
    transitions: [
      { from: 'start', to: 'task', type: 'DEFAULT' },
      { from: 'task', to: 'end', type: 'DECISION', label: 'Done' },
    ],
    fields: [{ step: 'start', code: 'DUE', type: 'DATE', capture: 'CREATION' }],
  };
  /** START -> WAIT for the company cutoff -> task -> END. */
  const waitFlow: FlowSpec = {
    steps: [
      { key: 'start', type: 'START' },
      { key: 'wait', type: 'WAIT', extra: { config: { mode: 'COMPANY_CUTOFF' } } },
      { key: 'task', type: 'TASK' },
      { key: 'end', type: 'END' },
    ],
    transitions: [
      { from: 'start', to: 'wait', type: 'DEFAULT' },
      { from: 'wait', to: 'task', type: 'DEFAULT' },
      { from: 'task', to: 'end', type: 'DECISION', label: 'Done' },
    ],
  };

  const create = async (flow: PublishedFlow, values: Record<string, unknown> = {}) =>
    (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: unique('Expense'), values }).expect(201)).body as { id: string };
  const visitOf = async (ticketId: string, stepId: string) => (await world.visits(ticketId)).find((visit) => visit.step_id === stepId)!;
  const addCutoff = (flow: PublishedFlow, cutoffDay: number, graceBusinessDays = 0) =>
    world.admin.post(`/workflows/${flow.workflowId}/cutoffs`, { companyId: world.tenant.companyId, cutoffDay, graceBusinessDays }).expect(201);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member([...REQUESTER_GRANTS, { action: 'read_assigned', subject: 'Ticket' }]);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('publishes now: neither the deadline nor the wait is refused as not implemented', async () => {
    await publishFlow(world.admin, deadlineFlow);
    await publishFlow(world.admin, waitFlow);
  });

  it('is due the field date plus the business days, cut at the company cutoff, with no due date while the field is blank', async () => {
    const flow = await publishFlow(world.admin, deadlineFlow);
    // Thursday 1 October + 3 business days: Tuesday 6 October at the 18:00 close in Bogotá.
    const loose = await create(flow, { DUE: '2026-10-01' });
    expect((await visitOf(loose.id, flow.step.task!)).due_at?.toISOString()).toBe('2026-10-06T23:00:00.000Z');
    const blank = await create(flow);
    expect((await visitOf(blank.id, flow.step.task!)).due_at).toBeNull();

    await addCutoff(flow, 5);
    const cut = await create(flow, { DUE: '2026-10-01' });
    expect((await visitOf(cut.id, flow.step.task!)).due_at?.toISOString()).toBe('2026-10-05T23:00:00.000Z');
  });

  it('holds the ticket until after the cutoff, and lets it through when the company has none', async () => {
    const flow = await publishFlow(world.admin, waitFlow);
    const through = await create(flow);
    expect((await world.ticketRow(through.id)).current_step_id).toBe(flow.step.task);
    expect((await world.events(through.id)).some((event) => event.data?.skipped === 'NO_CUTOFFS')).toBe(true);

    await addCutoff(flow, 28);
    const held = await create(flow);
    expect((await world.ticketRow(held.id)).current_step_id).toBe(flow.step.wait);
    const resumeAt = (await db.platform.query<{ resume_at: Date | null }>(`SELECT resume_at FROM ticket_step_visits WHERE tenant_id = $1 AND ticket_id = $2 AND exited_at IS NULL`, [world.tenant.tenantId, held.id])).rows[0]!.resume_at;
    expect(resumeAt).not.toBeNull();
    expect(resumeAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

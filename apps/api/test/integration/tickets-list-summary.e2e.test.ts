import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { ticketPageResponseSchema, type TicketSummaryResponse } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

describe('GET /tickets: what each row shows (names and the SLA of the current step)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let flow: PublishedFlow;
  let creator: Member;
  let first: Member;
  let second: Member;
  let reader: Member;
  let stranger: Member;
  let priority: { id: string; name: string; color: string };
  let ticket: { id: string; openVisitId: string };

  const nameOf = async (member: Member) =>
    (await db.platform.query<{ name: string }>(`SELECT first_name || ' ' || last_name AS name FROM users WHERE id = $1`, [member.userId])).rows[0]!.name;

  /** The row of the ticket as `member` sees it, after checking the page against the contract the web parses. */
  const rowFor = async (member: Member, view = 'all'): Promise<TicketSummaryResponse | undefined> => {
    const page = ticketPageResponseSchema.parse((await member.client.get(`/tickets?view=${view}&pageSize=100`).expect(200)).body);
    return page.items.find((item) => item.id === ticket.id);
  };

  const setOpenClocks = (assignments: string, values: readonly unknown[]) =>
    db.owner.query(`UPDATE ticket_sla_clocks SET ${assignments} WHERE ticket_id = $1 AND completed_at IS NULL`, [ticket.id, ...values]);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    creator = await world.member(REQUESTER_GRANTS);
    [first, second] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
    reader = await world.member([grant('read_all')]);
    stranger = await world.member([grant('read_created'), grant('read_assigned'), grant('read_observed')]);
    flow = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS', slaValue: 8, slaUnit: 'BUSINESS_HOURS' }, { name: 'Review', candidates: [user(first), user(second)] }));
    priority = { name: unique('High'), color: '#be123c', id: '' };
    priority.id = (await world.admin.post('/priorities', { name: priority.name, color: priority.color }).expect(201)).body.id as string;
    ticket = (await creator.client.post('/tickets', { subcategoryId: flow.subcategoryId, priorityId: priority.id, title: unique('Listed'), values: {} }).expect(201)).body;
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('keeps the ids and adds the names of the creator, subcategory and category, step, priority and assignees', async () => {
    const names = (await db.platform.query<{ subcategory: string; category_id: string; category: string }>(
      `SELECT s.name AS subcategory, c.id AS category_id, c.name AS category FROM subcategories s JOIN categories c ON c.tenant_id = s.tenant_id AND c.id = s.category_id WHERE s.id = $1`,
      [flow.subcategoryId],
    )).rows[0]!;
    const row = await rowFor(reader);
    expect(row).toMatchObject({
      creatorId: creator.userId,
      subcategoryId: flow.subcategoryId,
      currentStepId: flow.step.task,
      priorityId: priority.id,
      creator: { id: creator.userId, name: await nameOf(creator) },
      subcategory: { id: flow.subcategoryId, name: names.subcategory, category: { id: names.category_id, name: names.category } },
      currentStep: { id: flow.step.task, name: 'Review' },
      priority,
    });
    // Two candidates form a pool: both hold the step.
    const expected = [
      { userId: first.userId, name: await nameOf(first), type: 'POOL' },
      { userId: second.userId, name: await nameOf(second), type: 'POOL' },
    ].sort((a, b) => a.userId.localeCompare(b.userId));
    expect(row!.assignees).toMatchObject(expected);
  });

  it('the same row for every view that shows the ticket', async () => {
    const all = await rowFor(reader);
    expect(await rowFor(creator, 'created')).toEqual(all);
    expect(await rowFor(first, 'assigned')).toEqual(all);
  });

  it('carries the due date of the current step, and it is not overdue yet', async () => {
    const [clock] = await world.clocks(ticket.id);
    expect((await rowFor(reader))!.sla).toEqual({ dueAt: clock!.due_at!.toISOString(), overdue: false, paused: false });
  });

  it('is overdue once the due date has passed', async () => {
    await setOpenClocks(`due_at = now() - interval '1 hour'`, []);
    expect((await rowFor(reader))!.sla).toMatchObject({ overdue: true, paused: false });
  });

  it('a paused clock says so, and is late only if it already was when it was paused', async () => {
    await setOpenClocks(`due_at = now() + interval '1 hour', paused_at = now()`, []);
    expect((await rowFor(reader))!.sla).toMatchObject({ overdue: false, paused: true });
    await setOpenClocks(`due_at = now() - interval '2 hours', paused_at = now() - interval '1 hour'`, []);
    expect((await rowFor(reader))!.sla).toMatchObject({ overdue: true, paused: true });
    await setOpenClocks(`paused_at = NULL, due_at = now() + interval '1 hour'`, []);
  });

  it('a closed ticket has no assignees or SLA, and keeps its creator, priority and the step where it ended', async () => {
    await first.client.post(`/tickets/${ticket.id}/take`, { visitId: ticket.openVisitId }).expect(200);
    await first.client.post(`/tickets/${ticket.id}/transition`, { transitionId: flow.transition.Done!, visitId: ticket.openVisitId, values: {} }).expect(200);
    expect(await rowFor(reader)).toMatchObject({ status: 'CLOSED', currentStep: { id: flow.step.end, name: 'end' }, assignees: [], sla: null, creator: { id: creator.userId }, priority: { id: priority.id } });
  });

  it('a member who cannot read the ticket gets no row, so none of its names', async () => {
    expect(await rowFor(stranger)).toBeUndefined();
  });

  it('names never come from another tenant', async () => {
    const foreign = await TicketWorld.create(db, app);
    const page = ticketPageResponseSchema.parse((await foreign.admin.get('/tickets?view=all&pageSize=100').expect(200)).body);
    expect(page.items.map((item) => item.id)).not.toContain(ticket.id);
  });
});

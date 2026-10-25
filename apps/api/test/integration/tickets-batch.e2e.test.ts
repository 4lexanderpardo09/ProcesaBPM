import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { batchTransitionResponseSchema, ticketBatchGroupsResponseSchema } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, simpleFlow, SUPERVISOR_GRANTS, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

interface Created {
  readonly id: string;
  readonly openVisitId: string;
}

describe('answering several tickets of a step at once', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let supervisor: Member;
  let payments: PublishedFlow;
  let single: PublishedFlow;
  let tray: PublishedFlow;
  let byBank: PublishedFlow;

  const create = async (flow: PublishedFlow): Promise<Created> => (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: unique('Payment'), values: {} }).expect(201)).body as Created;
  const itemOf = (ticket: Created) => ({ ticketId: ticket.id, visitId: ticket.openVisitId });
  const run = async (as: Member, tickets: readonly Created[], values: Record<string, unknown> = { PAY_METHOD: 'Transfer' }) =>
    batchTransitionResponseSchema.parse((await as.client.post('/ticket-batches/transition', { transitionId: payments.transition.Done, items: tickets.map(itemOf), values, comment: '<p>Paid today</p>' }).expect(200)).body).results;
  const status = async (ticketId: string) => (await world.ticketRow(ticketId)).status;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    requester = await world.member(REQUESTER_GRANTS);
    worker = await world.member(WORKER_GRANTS);
    supervisor = await world.member(SUPERVISOR_GRANTS);
    const toWorker = { candidates: [{ participantType: 'USER', userId: worker.userId }] };
    payments = await publishFlow(world.admin, {
      ...simpleFlow({ assignmentMode: 'USERS', allowsBatch: true, config: { batch: { maxTickets: 3 } } }, toWorker),
      fields: [{ step: 'task', code: 'PAY_METHOD', type: 'TEXT', capture: 'STEP', isRequired: true }],
    });
    single = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, toWorker));
    tray = await publishFlow(world.admin, {
      ...simpleFlow({ assignmentMode: 'USERS', allowsBatch: true, config: { batch: { maxTickets: 5, title: 'Pagos del día', showFields: ['AMOUNT'], groupBy: 'COMPANY' } } }, toWorker),
      fields: [{ step: 'start', code: 'AMOUNT', type: 'NUMBER', capture: 'CREATION' }],
    });
    byBank = await publishFlow(world.admin, {
      ...simpleFlow({ assignmentMode: 'USERS', allowsBatch: true, config: { batch: { maxTickets: 5, groupBy: 'FIELD', groupFieldCode: 'BANK' } } }, toWorker),
      fields: [{ step: 'start', code: 'BANK', type: 'TEXT', capture: 'CREATION' }],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('lists the holder\'s tickets on batch steps, one group per step with its decisions', async () => {
    const [first, second] = [await create(payments), await create(payments)];
    const loose = await create(single);

    const groups = ticketBatchGroupsResponseSchema.parse((await worker.client.get('/ticket-batches').expect(200)).body);
    const group = groups.find((candidate) => candidate.stepId === payments.step.task)!;
    expect(group).toMatchObject({ workflowVersionId: payments.versionId, maxTickets: 3, decisions: [{ transitionId: payments.transition.Done, label: 'Done' }] });
    expect(group.tickets.map((ticket) => ticket.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(groups.flatMap((candidate) => candidate.tickets).map((ticket) => ticket.id)).not.toContain(loose.id);
    expect((await requester.client.get('/ticket-batches').expect(403)).body.error.code).toBe('PERMISSION_DENIED');
  });

  it('reads the tray as the step asks: its title, the data beside each ticket and its part of the tray', async () => {
    const ticket = (await requester.client.post('/tickets', { subcategoryId: tray.subcategoryId, title: unique('Payment'), values: { AMOUNT: 1500 } }).expect(201)).body as Created;

    const groups = ticketBatchGroupsResponseSchema.parse((await worker.client.get('/ticket-batches').expect(200)).body);
    const group = groups.find((candidate) => candidate.stepId === tray.step.task)!;
    expect(group).toMatchObject({ title: 'Pagos del día', groupBy: 'COMPANY', groupField: null, shownFields: [{ code: 'AMOUNT', label: 'AMOUNT', type: 'NUMBER', config: {} }] });
    const row = group.tickets.find((candidate) => candidate.id === ticket.id)!;
    expect(row.values).toEqual({ AMOUNT: 1500 });
    expect(row.subgroup).toEqual({ key: expect.any(String), name: row.companyName });
    expect(groups.find((candidate) => candidate.stepId === payments.step.task)).toMatchObject({ title: null, shownFields: [], groupBy: null });

    const none = ticketBatchGroupsResponseSchema.parse((await worker.client.get('/ticket-batches?cutoffId=018f0000-0000-7000-8000-000000000000').expect(200)).body);
    expect(none).toEqual([]);
    await worker.client.get('/ticket-batches?cutoffId=nope').expect(400);
  });

  it('splits the tray by the value of a field, with the value beside each ticket', async () => {
    const open = async (values: Record<string, unknown>) => ((await requester.client.post('/tickets', { subcategoryId: byBank.subcategoryId, title: unique('Payment'), values }).expect(201)).body as Created).id;
    const [first, second, none] = [await open({ BANK: 'Bancolombia' }), await open({ BANK: 'Davivienda' }), await open({})];

    const groups = ticketBatchGroupsResponseSchema.parse((await worker.client.get('/ticket-batches').expect(200)).body);
    const group = groups.find((candidate) => candidate.stepId === byBank.step.task)!;
    expect(group).toMatchObject({ groupBy: 'FIELD', groupField: { code: 'BANK', type: 'TEXT' }, shownFields: [] });
    const row = (id: string) => group.tickets.find((candidate) => candidate.id === id)!;
    expect(row(first)).toMatchObject({ values: { BANK: 'Bancolombia' }, subgroup: { key: '"Bancolombia"', name: 'Bancolombia' } });
    expect(row(second).subgroup).toEqual({ key: '"Davivienda"', name: 'Davivienda' });
    expect(row(none)).toMatchObject({ values: {}, subgroup: { key: '', name: '' } });
  });

  it('moves every ticket it can with the same values, and says why the others stayed', async () => {
    const [first, second] = [await create(payments), await create(payments)];
    const loose = await create(single);

    const results = await run(worker, [first, second, loose]);

    expect(results.map((result) => [result.ticketId, result.ok])).toEqual([[first.id, true], [second.id, true], [loose.id, false]]);
    expect(results[2]).toMatchObject({ ok: false, error: { code: 'INVALID_STATE' } });
    expect([await status(first.id), await status(second.id), await status(loose.id)]).toEqual(['CLOSED', 'CLOSED', 'OPEN']);
    const detail = (await worker.client.get(`/tickets/${first.id}`).expect(200)).body;
    expect(detail.values.PAY_METHOD).toBe('Transfer');
  });

  it('fails each ticket alone when the step values are wrong, moving none', async () => {
    const [first, second] = [await create(payments), await create(payments)];
    const results = await run(worker, [first, second], {});
    expect(results.map((result) => (result.ok ? 'ok' : result.error.code))).toEqual(['FIELD_VALUES_INVALID', 'FIELD_VALUES_INVALID']);
    expect([await status(first.id), await status(second.id)]).toEqual(['OPEN', 'OPEN']);
  });

  it('refuses more tickets of a step than it takes, and tickets the caller does not hold', async () => {
    const four = [await create(payments), await create(payments), await create(payments), await create(payments)];
    expect((await run(worker, four)).every((result) => !result.ok && result.error.code === 'INVALID_STATE')).toBe(true);

    const held = await create(payments);
    expect(await run(supervisor, [held])).toMatchObject([{ ok: false, error: { code: 'PERMISSION_DENIED' } }]);
    expect(await status(held.id)).toBe('OPEN');
  });
});

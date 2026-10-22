import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { exportCutoffResponseSchema, exportDefinitionResponseSchema, generateExportCutoffResponseSchema } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ExportCutoffJob } from '../../src/modules/exports/application/export-cutoff.job.js';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, type PublishedFlow, publishVersion, REQUESTER_GRANTS, simpleFlow, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';
import { MailWorker } from '../support/worker-mail.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });
const fields = [
  { step: 'start', code: 'DOC', type: 'TEXT', capture: 'CREATION' as const },
  { step: 'start', code: 'AMOUNT', type: 'NUMBER', capture: 'CREATION' as const },
];
const columns = [
  { header: 'Doc', sourceType: 'FIELD', sourceRef: 'DOC' },
  { header: 'Amount', sourceType: 'FIELD', sourceRef: 'AMOUNT', format: 'INTEGER' },
  { header: 'Name', sourceType: 'REQUESTER', sourceRef: 'FULL_NAME', format: 'UPPER' },
  { header: 'Row', sourceType: 'SEQUENCE' },
  { header: 'Cutoff', sourceType: 'CUTOFF_DATE' },
];

describe('scheduled exports ("planos")', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let worker: MailWorker;
  let requester: Member;
  let reviewer: Member;
  let flow: PublishedFlow;

  const definition = (workflowId: string, overrides: Record<string, unknown> = {}) => ({
    workflowId,
    name: unique('Payments'),
    format: 'CSV',
    trigger: 'TRANSITION',
    transitionLabel: 'Done',
    filter: [{ fieldCode: 'DOC', operator: 'NOT_EQUALS', value: 'skip' }],
    mergeBy: 'Doc',
    schedule: { cutoffTime: '00:00', frequency: 'DAILY' },
    columns,
    ...overrides,
  });
  const createExport = async (body: Record<string, unknown>) => exportDefinitionResponseSchema.parse((await world.admin.post('/exports', body).expect(201)).body);
  const exportOf = async (id: string) => exportDefinitionResponseSchema.parse((await world.admin.get(`/exports/${id}`).expect(200)).body);
  const create = async (target: PublishedFlow, values: Record<string, unknown>) =>
    (await requester.client.post('/tickets', { subcategoryId: target.subcategoryId, title: unique('Payment'), values }).expect(201)).body as { id: string; openVisitId: string };
  const move = async (ticket: { id: string; openVisitId: string }, transitionId: string, as: Member = requester) =>
    (await as.client.post(`/tickets/${ticket.id}/transition`, { transitionId, visitId: ticket.openVisitId }).expect(200)).body as { id: string; openVisitId: string };
  const fileText = async (cutoffId: string, path = `/export-cutoffs/${cutoffId}/download-url`, as = world.admin) => {
    const { url } = (await as.get(path).expect(200)).body as { url: string };
    return (await fetch(url)).text();
  };

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    worker = await MailWorker.start();
    requester = await world.member([...REQUESTER_GRANTS, grant('transition'), grant('read_assigned')]);
    reviewer = await world.member(WORKER_GRANTS);
    await db.platform.query(`UPDATE users SET first_name = 'Ana', last_name = 'Pérez' WHERE id = $1`, [requester.userId]);
    flow = await publishFlow(world.admin, { ...simpleFlow(), fields });
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await db.close();
  });

  it('writes a line when a ticket takes the transition and passes the filter, and gathers them into a file now', async () => {
    const payments = await createExport(definition(flow.workflowId));
    expect(payments).toMatchObject({ pendingLines: 0, isActive: true });
    expect(payments.nextCutoffAt).not.toBeNull();

    for (const [doc, amount] of [['1.144', 100], ['1144', 50], ['skip', 7]] as const) await move(await create(flow, { DOC: doc, AMOUNT: amount }), flow.transition.Done!);
    await worker.deliver();
    expect((await exportOf(payments.id)).pendingLines).toBe(2);

    const generated = generateExportCutoffResponseSchema.parse((await world.admin.post(`/exports/${payments.id}/cutoffs`, {}).expect(200)).body);
    expect(generated.cutoffs).toHaveLength(1);
    expect(generated.cutoffs[0]).toMatchObject({ lineCount: 1, isManual: true, hasFile: true, groupLabel: null });
    const cutoffDate = generated.cutoffs[0]!.cutoffDate;
    const [year, month, day] = cutoffDate.split('-');
    // The two lines of the same document merged: amounts add up, the rest keeps the first value.
    expect(await fileText(generated.cutoffs[0]!.id)).toBe(`Doc;Amount;Name;Row;Cutoff\r\n1.144;150;ANA PÉREZ;1;${day}/${month}/${year}\r\n`);

    expect((await exportOf(payments.id)).pendingLines).toBe(0);
    expect(generateExportCutoffResponseSchema.parse((await world.admin.post(`/exports/${payments.id}/cutoffs`, {}).expect(200)).body).cutoffs).toEqual([]);
  });

  it('runs the scheduled cutoff once when it is due, closing the period even without lines', async () => {
    const daily = await createExport(definition(flow.workflowId, { mergeBy: null, filter: [] }));
    await move(await create(flow, { DOC: '77', AMOUNT: 3 }), flow.transition.Done!);
    await worker.deliver();

    await worker.module.get(ExportCutoffJob).runOnce();
    const cutoffs = z.array(exportCutoffResponseSchema).parse((await world.admin.get(`/exports/${daily.id}/cutoffs`).expect(200)).body);
    expect(cutoffs).toHaveLength(1);
    expect(cutoffs[0]).toMatchObject({ isManual: false, lineCount: 1 });
    expect((await exportOf(daily.id)).lastAutoCutoffAt).not.toBeNull();

    await worker.module.get(ExportCutoffJob).runOnce();
    expect((await world.admin.get(`/exports/${daily.id}/cutoffs`).expect(200)).body).toHaveLength(1);
  });

  it('separates the files by whoever holds a step, and each person sees and downloads only their own', async () => {
    const spec: FlowSpec = {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'prepare', type: 'TASK' },
        { key: 'review', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [{ participantType: 'USER', userId: reviewer.userId }] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'prepare', type: 'DEFAULT' },
        { from: 'prepare', to: 'review', type: 'DECISION', label: 'Send' },
        { from: 'review', to: 'end', type: 'DECISION', label: 'Done' },
      ],
      fields,
    };
    const reviewed = await publishFlow(world.admin, spec);
    const byReviewer = await createExport(definition(reviewed.workflowId, { transitionLabel: 'Send', mergeBy: null, filter: [], separateBy: { kind: 'RESPONSIBLE', stepId: reviewed.step.review } }));
    await move(await create(reviewed, { DOC: '5', AMOUNT: 9 }), reviewed.transition.Send!);
    await worker.deliver();

    const generated = generateExportCutoffResponseSchema.parse((await world.admin.post(`/exports/${byReviewer.id}/cutoffs`, {}).expect(200)).body);
    expect(generated.cutoffs).toHaveLength(1);
    expect(generated.cutoffs[0]).toMatchObject({ responsibleId: reviewer.userId, lineCount: 1 });
    const cutoffId = generated.cutoffs[0]!.id;

    const mine = z.array(exportCutoffResponseSchema).parse((await reviewer.client.get('/export-cutoffs/mine').expect(200)).body);
    expect(mine.map((cutoff) => cutoff.id)).toEqual([cutoffId]);
    expect(await fileText(cutoffId, `/export-cutoffs/mine/${cutoffId}/download-url`, reviewer.client)).toContain('\r\n5;9;ANA PÉREZ;1;');
    expect((await requester.client.get('/export-cutoffs/mine').expect(200)).body).toEqual([]);
    await requester.client.get(`/export-cutoffs/mine/${cutoffId}/download-url`).expect(404);
    await requester.client.get(`/export-cutoffs/${cutoffId}/download-url`).expect(403);
  });

  it('holds a ticket on a step that waits for its line to come out in a file', async () => {
    const category = (await world.admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
    const subcategoryId = (await world.admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
    const workflow = (await world.admin.post('/workflows', { subcategoryId, name: unique('Flow') }).expect(201)).body as { id: string; versions: Array<{ id: string }> };
    const accounting = await createExport(definition(workflow.id, { transitionLabel: 'Send', mergeBy: null, filter: [] }));
    const published = await publishVersion(world.admin, workflow.id, workflow.versions[0]!.id, {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'prepare', type: 'TASK' },
        { key: 'confirm', type: 'TASK', extra: { config: { requiredExportId: accounting.id } } },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'prepare', type: 'DEFAULT' },
        { from: 'prepare', to: 'confirm', type: 'DECISION', label: 'Send' },
        { from: 'confirm', to: 'end', type: 'DECISION', label: 'Done' },
      ],
      fields,
    });
    const target = { subcategoryId, workflowId: workflow.id, versionId: workflow.versions[0]!.id, ...published };
    const sent = await move(await create(target, { DOC: '8', AMOUNT: 1 }), target.transition.Send!);
    await worker.deliver();

    const refused = await requester.client.post(`/tickets/${sent.id}/transition`, { transitionId: target.transition.Done, visitId: sent.openVisitId }).expect(422);
    expect(refused.body.error.code).toBe('EXPORT_CUTOFF_PENDING');
    await world.admin.post(`/exports/${accounting.id}/cutoffs`, {}).expect(200);
    await move(sent, target.transition.Done!);
  });

  it('refuses a definition whose separation step is not of its workflow, and keeps catalogs per name', async () => {
    const other = await publishFlow(world.admin, simpleFlow());
    const refused = await world.admin.post('/exports', definition(flow.workflowId, { separateBy: { kind: 'RESPONSIBLE', stepId: other.step.task } })).expect(422);
    expect(refused.body.error.code).toBe('INVALID_REFERENCE');

    await world.admin.put('/export-catalogs/BANKS', { entries: [{ inputValue: 'Bancolombia', outputValue: '07' }] }).expect(200);
    expect((await world.admin.get('/export-catalogs/BANKS').expect(200)).body).toEqual({ catalog: 'BANKS', entries: [{ inputValue: 'Bancolombia', outputValue: '07' }] });
    expect((await world.admin.get('/export-catalogs').expect(200)).body).toContain('BANKS');
  });
});

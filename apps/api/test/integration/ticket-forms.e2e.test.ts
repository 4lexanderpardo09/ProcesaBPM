import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, type PublishedFlow, publishFlow, simpleFlow, TicketWorld, unique } from '../support/ticket-world.js';

useTestEnvironment();

const grant = (action: string) => ({ action, subject: 'Ticket' });
const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });

/** START (two creation fields) → TASK of the creator (one step field, two decisions) → END. */
const formFlow = (initiators?: ReadonlyArray<Record<string, unknown>>): FlowSpec => ({
  steps: [{ key: 'start', type: 'START', ...(initiators === undefined ? {} : { initiators }) }, { key: 'task', type: 'TASK', name: 'Review' }, { key: 'end', type: 'END' }],
  transitions: [
    { from: 'start', to: 'task', type: 'DEFAULT' },
    { from: 'task', to: 'end', type: 'DECISION', label: 'Reject', sortOrder: 2 },
    { from: 'task', to: 'end', type: 'DECISION', label: 'Approve', sortOrder: 1 },
  ],
  fields: [
    { step: 'start', code: 'AMOUNT', type: 'NUMBER', capture: 'CREATION', isRequired: true },
    { step: 'start', code: 'REASON', type: 'TEXT', capture: 'CREATION' },
    { step: 'task', code: 'NOTES', type: 'TEXT', capture: 'STEP' },
  ],
});

describe('ticket forms', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let member: Member;
  let colleague: Member;
  let reader: Member;
  let flow: PublishedFlow;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    member = await world.member([grant('create'), grant('read_created'), grant('transition')]);
    colleague = await world.member([grant('create'), grant('read_created')]);
    reader = await world.member([grant('read_created')]);
    flow = await publishFlow(world.admin, formFlow());
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('GET /subcategories/:id/creation-form', () => {
    it('lists the start with its creation fields, in order, and the version it belongs to', async () => {
      const form = (await member.client.get(`/subcategories/${flow.subcategoryId}/creation-form`).expect(200)).body;
      expect(form).toMatchObject({ subcategoryId: flow.subcategoryId, workflowId: flow.workflowId, versionId: flow.versionId, companyId: expect.any(String) });
      expect(form.starts).toHaveLength(1);
      expect(form.starts[0].stepId).toBe(flow.step.start);
      expect(form.starts[0].fields.map((field: { code: string }) => field.code)).toEqual(['AMOUNT', 'REASON']);
      expect(form.starts[0].fields[0]).toMatchObject({ type: 'NUMBER', isRequired: true, stepId: flow.step.start });
    });

    it('only offers the starts that admit the caller, with the same error as creating', async () => {
      const restricted = await publishFlow(world.admin, formFlow([user(colleague)]));
      expect((await colleague.client.get(`/subcategories/${restricted.subcategoryId}/creation-form`).expect(200)).body.starts).toHaveLength(1);
      const refused = (await member.client.get(`/subcategories/${restricted.subcategoryId}/creation-form`).expect(403)).body;
      expect(refused.error.code).toBe('INITIATOR_NOT_ALLOWED');
      const created = await member.client.post('/tickets', { subcategoryId: restricted.subcategoryId, title: unique('T'), values: { AMOUNT: 1 } }).expect(403);
      expect(created.body.error.code).toBe('INITIATOR_NOT_ALLOWED');
    });

    it('draws the form and the catalog of someone else for whoever creates for others, and only for them', async () => {
      const desk = await world.member([grant('create_for_others'), grant('read_all')]);
      const restricted = await publishFlow(world.admin, formFlow([user(colleague)]));
      // The desk is not an initiator of the restricted flow, the colleague is: the form and the catalog are the colleague's.
      const form = (await desk.client.get(`/subcategories/${restricted.subcategoryId}/creation-form?requesterId=${colleague.userId}`).expect(200)).body;
      expect(form.starts).toHaveLength(1);
      const catalog = (await desk.client.get(`/catalog/available?requesterId=${colleague.userId}`).expect(200)).body;
      expect(catalog.categories.flatMap((category: { subcategories: Array<{ id: string }> }) => category.subcategories.map((subcategory) => subcategory.id))).toContain(restricted.subcategoryId);
      expect(catalog.companies.length).toBeGreaterThan(0);
      const created = await desk.client.post('/tickets', { subcategoryId: restricted.subcategoryId, requesterId: colleague.userId, title: unique('T'), values: { AMOUNT: 1 } }).expect(201);
      expect(created.body.ticket ?? created.body).toBeTruthy();

      await member.client.get(`/subcategories/${flow.subcategoryId}/creation-form?requesterId=${colleague.userId}`).expect(403);
      await member.client.get(`/catalog/available?requesterId=${colleague.userId}`).expect(403);
    });

    it('offers the subcategories of the person\'s latest tickets as a shortcut, the most recent first, while they can still pick them', async () => {
      const opener = await world.member([grant('create'), grant('read_created')]);
      const [first, second] = [await publishFlow(world.admin, simpleFlow()), await publishFlow(world.admin, simpleFlow())];
      const recent = async () => (await opener.client.get('/catalog/available').expect(200)).body.recent as string[];
      expect(await recent()).toEqual([]);
      for (const target of [first, second, first]) await opener.client.post('/tickets', { subcategoryId: target.subcategoryId, title: unique('T'), values: {} }).expect(201);
      await opener.client.post('/tickets', { subcategoryId: second.subcategoryId, title: unique('T'), values: {} }).expect(201);
      expect(await recent()).toEqual([second.subcategoryId, first.subcategoryId]);
      // Someone else's tickets are theirs, and a subcategory switched off drops out.
      expect((await colleague.client.get('/catalog/available').expect(200)).body.recent).not.toContain(second.subcategoryId);
      await world.admin.post(`/subcategories/${second.subcategoryId}/deactivate`).expect(200);
      expect(await recent()).toEqual([first.subcategoryId]);
    });

    it('needs the create permission and an existing subcategory', async () => {
      await reader.client.get(`/subcategories/${flow.subcategoryId}/creation-form`).expect(403);
      await member.client.get('/subcategories/0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90/creation-form').expect(404);
    });
  });

  describe('formula columns of a table', () => {
    it('computes each row and the total from the other columns, ignoring what the client sends for them', async () => {
      const counted = await publishFlow(world.admin, {
        ...simpleFlow(),
        fields: [
          {
            step: 'start',
            code: 'COUNT',
            type: 'TABLE',
            capture: 'CREATION',
            config: { columns: [{ code: 'QTY', label: 'Cantidad', type: 'NUMBER' }, { code: 'VALUE', label: 'Valor', type: 'CURRENCY' }, { code: 'SUB', label: 'Subtotal', type: 'FORMULA', expression: 'QTY * VALUE', showTotal: true }] },
          },
          { step: 'start', code: 'TOTAL', type: 'FORMULA', capture: 'CREATION', config: { expression: 'SUM(COUNT.SUB)', resultType: 'CURRENCY' } },
        ],
      });
      const created = (await member.client.post('/tickets', { subcategoryId: counted.subcategoryId, title: unique('T'), values: { COUNT: [{ QTY: 3, VALUE: '50000', SUB: 1 }, { QTY: 2, VALUE: '500.50' }] } }).expect(201)).body.id as string;
      const detail = (await member.client.get(`/tickets/${created}`).expect(200)).body as { values: { COUNT: Array<Record<string, unknown>>; TOTAL: unknown }; totals: Record<string, Record<string, string>> };
      expect(detail.values.COUNT.map((row) => row.SUB)).toEqual([150000, 1001]);
      expect(detail.totals.COUNT).toEqual({ SUB: '151001' });
      expect(Number(detail.values.TOTAL)).toBe(151001);
    });
  });

  describe('«fecha actual»', () => {
    it('fills an empty date and date-time with the moment of the submission, even read-only, and keeps a typed one', async () => {
      const dated = await publishFlow(world.admin, {
        ...simpleFlow(),
        fields: [
          { step: 'start', code: 'RECEIVED_ON', type: 'DATE', capture: 'CREATION', isReadOnly: true, config: { defaultNow: true } },
          { step: 'start', code: 'PAID_ON', type: 'DATE', capture: 'CREATION', isRequired: true, config: { defaultNow: true } },
          { step: 'start', code: 'STAMP', type: 'DATETIME', capture: 'CREATION', config: { defaultNow: true } },
        ],
      });
      const before = Date.now();
      const empty = (await member.client.post('/tickets', { subcategoryId: dated.subcategoryId, title: unique('T'), values: {} }).expect(201)).body.id as string;
      const values = (await member.client.get(`/tickets/${empty}`).expect(200)).body.values as Record<string, string>;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
      expect(values.RECEIVED_ON).toBe(today);
      expect(values.PAID_ON).toBe(today);
      expect(Date.parse(values.STAMP!)).toBeGreaterThanOrEqual(before - 1000);

      const typed = (await member.client.post('/tickets', { subcategoryId: dated.subcategoryId, title: unique('T'), values: { PAID_ON: '2026-01-15' } }).expect(201)).body.id as string;
      expect((await member.client.get(`/tickets/${typed}`).expect(200)).body.values.PAID_ON).toBe('2026-01-15');
      // Read-only is still read-only: nobody types it.
      const refused = await member.client.post('/tickets', { subcategoryId: dated.subcategoryId, title: unique('T'), values: { RECEIVED_ON: '2026-01-15' } }).expect(422);
      expect(refused.body.error.details.issues).toEqual([{ code: 'NOT_EDITABLE', fieldCode: 'RECEIVED_ON' }]);
    });
  });

  describe('GET /tickets/:id/form', () => {
    let ticketId: string;

    beforeAll(async () => {
      ticketId = (await member.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: unique('T'), values: { AMOUNT: 5 } }).expect(201)).body.id as string;
    });

    it('describes the current step: fields to fill there, every field to show, and the decisions in order', async () => {
      const detail = (await member.client.get(`/tickets/${ticketId}`).expect(200)).body;
      const form = (await member.client.get(`/tickets/${ticketId}/form`).expect(200)).body;
      expect(form).toMatchObject({ ticketId, versionId: flow.versionId, visitId: detail.openVisit.id, step: { id: flow.step.task, name: 'Review', type: 'TASK' } });
      expect(form.editableFieldCodes).toEqual(['NOTES']);
      expect(form.fields.map((field: { code: string }) => field.code).sort()).toEqual(['AMOUNT', 'NOTES', 'REASON']);
      expect(form.decisions).toEqual([
        { transitionId: flow.transition.Approve, label: 'Approve', requiresComment: false },
        { transitionId: flow.transition.Reject, label: 'Reject', requiresComment: false },
      ]);
    });

    it('a decision from the form moves the ticket, and a closed ticket has no step to fill', async () => {
      const form = (await member.client.get(`/tickets/${ticketId}/form`).expect(200)).body;
      await member.client.post(`/tickets/${ticketId}/transition`, { transitionId: form.decisions[0].transitionId, visitId: form.visitId, values: { NOTES: 'ok' } }).expect(200);
      const closed = (await member.client.get(`/tickets/${ticketId}/form`).expect(200)).body;
      expect(closed).toMatchObject({ step: null, visitId: null, editableFieldCodes: [], decisions: [] });
      expect(closed.fields).toHaveLength(3);
    });

    it('someone who cannot read the ticket gets 404', async () => {
      await colleague.client.get(`/tickets/${ticketId}/form`).expect(404);
    });
  });
});

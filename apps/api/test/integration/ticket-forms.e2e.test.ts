import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, type PublishedFlow, publishFlow, TicketWorld, unique } from '../support/ticket-world.js';

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

    it('needs the create permission and an existing subcategory', async () => {
      await reader.client.get(`/subcategories/${flow.subcategoryId}/creation-form`).expect(403);
      await member.client.get('/subcategories/0192f3a0-7c1b-7d2e-8a3f-4b5c6d7e8f90/creation-form').expect(404);
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
        { transitionId: flow.transition.Approve, label: 'Approve' },
        { transitionId: flow.transition.Reject, label: 'Reject' },
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

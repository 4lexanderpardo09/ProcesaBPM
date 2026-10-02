import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, TicketWorld, WORKER_GRANTS, unique } from '../support/ticket-world.js';

useTestEnvironment();

describe('ticket flow (create, advance, close)', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let reviewer: Member;
  let approver: Member;
  let manager: Member;
  let purchases: PublishedFlow;

  const count = async () => Number((await db.platform.query(`SELECT count(*)::int AS n FROM tickets WHERE tenant_id = $1`, [world.tenant.tenantId])).rows[0].n);
  const create = (flow: PublishedFlow, body: Record<string, unknown> = {}, as = requester) => as.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Request', ...body });
  const move = (as: Member, ticketId: string, transitionId: string, visitId: string, body: Record<string, unknown> = {}) =>
    as.client.post(`/tickets/${ticketId}/transition`, { transitionId, visitId, ...body });
  const types = async (ticketId: string) => (await world.events(ticketId)).map((event) => event.type);

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    [requester, reviewer, approver, manager] = [await world.member(REQUESTER_GRANTS), await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];

    const typeId = (await world.admin.post('/approval-group-types', { name: unique('Purchases') }).expect(201)).body.id as string;
    const groupId = (await world.admin.post('/approval-groups', { typeId, name: unique('Approvers') }).expect(201)).body.id as string;
    await world.admin.put(`/approval-groups/${groupId}/members`, { userIds: [requester.userId] }).expect(200);
    await world.admin.put(`/approval-groups/${groupId}/approvers`, { userIds: [approver.userId] }).expect(200);

    purchases = await publishFlow(world.admin, {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'review', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [{ participantType: 'USER', userId: reviewer.userId }] },
        { key: 'approval', type: 'APPROVAL', extra: { assignmentMode: 'APPROVER', approvalGroupTypeId: typeId, approvalLevel: 1 } },
        { key: 'amount', type: 'CONDITION' },
        { key: 'directors', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [{ participantType: 'USER', userId: manager.userId }] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'review', type: 'DEFAULT' },
        { from: 'review', to: 'approval', type: 'DECISION', label: 'Send to approval' },
        { from: 'approval', to: 'amount', type: 'DECISION', label: 'Approve' },
        { from: 'amount', to: 'directors', type: 'CONDITION', label: 'Big', condition: [{ field: 'AMOUNT', op: 'gt', value: 1000 }] },
        { from: 'amount', to: 'end', type: 'DEFAULT', label: 'Small' },
        { from: 'directors', to: 'end', type: 'DECISION', label: 'Sign off' },
      ],
      fields: [{ step: 'start', code: 'AMOUNT', type: 'CURRENCY', capture: 'CREATION', isRequired: true }],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('the complete flow: task, approval by group, amount condition, two branches, end', () => {
    it('a big amount goes through the directors and ends closed', async () => {
      const created = await create(purchases, { values: { AMOUNT: '5000.50' } }).expect(201);
      const ticketId = created.body.id as string;
      expect(created.body).toMatchObject({ status: 'OPEN', currentStepId: purchases.step.review });
      expect(await world.assignees(ticketId)).toEqual([{ user_id: reviewer.userId, type: 'PRIMARY' }]);
      expect(await types(ticketId)).toEqual(['CREATED', 'TRANSITIONED', 'ASSIGNED']);
      expect((await world.events(ticketId))[1]).toMatchObject({ actor_id: null, step_id: purchases.step.start, data: { automatic: true, blockType: 'START' } });
      const [createdEvent] = await world.outbox('ticket.created', ticketId);
      expect(createdEvent).toMatchObject({ number: created.body.number, creatorId: requester.userId });
      const stored = (await reviewer.client.get(`/tickets/${ticketId}`).expect(200)).body;
      expect(stored.values).toEqual({ AMOUNT: 5000.5 });

      const toApproval = await move(reviewer, ticketId, purchases.transition['Send to approval']!, created.body.openVisitId).expect(200);
      expect(toApproval.body.currentStepId).toBe(purchases.step.approval);
      expect(await world.assignees(ticketId)).toEqual([{ user_id: approver.userId, type: 'PRIMARY' }]);

      const approved = await move(approver, ticketId, purchases.transition.Approve!, toApproval.body.openVisitId).expect(200);
      expect(approved.body.currentStepId).toBe(purchases.step.directors);
      const automatic = (await world.events(ticketId)).filter((event) => event.actor_id === null && event.data?.blockType === 'CONDITION');
      expect(automatic).toEqual([expect.objectContaining({ step_id: purchases.step.amount, transition_id: purchases.transition.Big })]);
      expect(await world.assignees(ticketId)).toEqual([{ user_id: manager.userId, type: 'PRIMARY' }]);

      const signed = await move(manager, ticketId, purchases.transition['Sign off']!, approved.body.openVisitId).expect(200);
      expect(signed.body).toMatchObject({ status: 'CLOSED', openVisitId: null });
      expect(await world.ticketRow(ticketId)).toMatchObject({ status: 'CLOSED', closed_by_id: manager.userId, current_step_id: purchases.step.end });
      expect(await world.assignees(ticketId)).toEqual([]);
      expect((await world.visits(ticketId)).map((visit) => [visit.step_id, visit.exited_at !== null])).toEqual([
        [purchases.step.review, true],
        [purchases.step.approval, true],
        [purchases.step.directors, true],
      ]);
      expect((await world.clocks(ticketId)).every((clock) => clock.completed_at !== null)).toBe(true);
      expect(await types(ticketId)).toEqual(['CREATED', 'TRANSITIONED', 'ASSIGNED', 'TRANSITIONED', 'ASSIGNED', 'TRANSITIONED', 'TRANSITIONED', 'ASSIGNED', 'TRANSITIONED', 'CLOSED']);
      expect((await world.outbox('ticket.closed', ticketId))[0]).toMatchObject({ closedById: manager.userId });
      expect(await world.outbox('ticket.transitioned', ticketId)).toHaveLength(3);
    });

    it('a small amount skips the directors: the workflow ends and the ticket closes by itself', async () => {
      const created = await create(purchases, { values: { AMOUNT: 500 } }).expect(201);
      const toApproval = await move(reviewer, created.body.id, purchases.transition['Send to approval']!, created.body.openVisitId).expect(200);
      const approved = await move(approver, created.body.id, purchases.transition.Approve!, toApproval.body.openVisitId).expect(200);
      expect(approved.body).toMatchObject({ status: 'CLOSED', currentStepId: purchases.step.end, openVisitId: null });
      expect(await world.ticketRow(created.body.id)).toMatchObject({ status: 'CLOSED', closed_by_id: approver.userId });
      expect(await types(created.body.id)).toContain('CLOSED');
    });

    it('numbers tickets per tenant in sequence', async () => {
      const [a, b] = [await create(purchases, { values: { AMOUNT: 1 } }).expect(201), await create(purchases, { values: { AMOUNT: 1 } }).expect(201)];
      expect(Number(b.body.number)).toBe(Number(a.body.number) + 1);
    });
  });

  describe('creating', () => {
    it('validates the values before writing anything', async () => {
      const before = await count();
      const missing = await create(purchases, { values: {} }).expect(422);
      expect(missing.body.error).toMatchObject({ code: 'FIELD_VALUES_INVALID', details: { issues: [{ code: 'REQUIRED', fieldCode: 'AMOUNT' }] } });
      expect((await create(purchases, { values: { AMOUNT: '1.500.000' } }).expect(422)).body.error.details.issues[0]).toMatchObject({ code: 'INVALID_TYPE' });
      expect((await create(purchases, { values: { AMOUNT: 10, GHOST: 1 } }).expect(422)).body.error.details.issues[0]).toMatchObject({ code: 'UNKNOWN_FIELD', fieldCode: 'GHOST' });
      expect(await count()).toBe(before);
    });

    it('a subcategory without a published workflow is refused', async () => {
      const category = (await world.admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id;
      const subcategoryId = (await world.admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id;
      expect((await requester.client.post('/tickets', { subcategoryId, title: 'x', values: {} }).expect(422)).body.error.code).toBe('WORKFLOW_NOT_AVAILABLE');
    });

    it('creating on behalf of someone needs create_for_others; the registrar is kept', async () => {
      expect((await create(purchases, { values: { AMOUNT: 1 }, requesterId: reviewer.userId }).expect(403)).body.error.code).toBe('PERMISSION_DENIED');
      const registrar = await world.member([{ action: 'create_for_others', subject: 'Ticket' }]);
      const created = await create(purchases, { values: { AMOUNT: 1 }, requesterId: requester.userId }, registrar).expect(201);
      expect(await world.ticketRow(created.body.id)).toMatchObject({ creator_id: requester.userId, registered_by_id: registrar.userId });
    });

    it('a company that is not the requester\'s is refused, and several companies need a choice', async () => {
      const other = (await world.admin.post('/companies', { name: unique('Other'), countryCode: 'CO' }).expect(201)).body.id as string;
      expect((await create(purchases, { values: { AMOUNT: 1 }, companyId: other }).expect(422)).body.error.code).toBe('INVALID_REFERENCE');
      const traveller = await world.member(REQUESTER_GRANTS);
      await db.platform.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [world.tenant.tenantId, traveller.userId, other]);
      expect((await create(purchases, { values: { AMOUNT: 1 } }, traveller).expect(422)).body.error.code).toBe('COMPANY_REQUIRED');
      const chosen = await create(purchases, { values: { AMOUNT: 1 }, companyId: other }, traveller).expect(201);
      expect((await db.platform.query(`SELECT company_id FROM tickets WHERE id = $1`, [chosen.body.id])).rows[0].company_id).toBe(other);
    });

    it('the description and the comments are sanitized with an allowlist', async () => {
      const created = await create(purchases, { values: { AMOUNT: 1 }, description: '<p>Hi <strong>there</strong></p><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)>' }).expect(201);
      expect((await requester.client.get(`/tickets/${created.body.id}`).expect(200)).body.descriptionHtml).toBe('<p>Hi <strong>there</strong></p><a rel="noopener noreferrer nofollow" target="_blank">x</a>');
      const moved = await move(reviewer, created.body.id, purchases.transition['Send to approval']!, created.body.openVisitId, { comment: '<b>ok</b><script>x</script>' }).expect(200);
      const empty = await move(approver, created.body.id, purchases.transition.Approve!, moved.body.openVisitId, { comment: '<script>x</script>' }).expect(200);
      expect(empty.body.currentStepId).toBeDefined();
      const comments = (await world.db.platform.query(`SELECT comment_html FROM ticket_events WHERE ticket_id = $1 AND type = 'TRANSITIONED' AND actor_id IS NOT NULL ORDER BY seq`, [created.body.id])).rows.map((row) => row.comment_html);
      expect(comments).toEqual(['<b>ok</b>', null]);
    });
  });

  describe('transitions', () => {
    it('only a current assignee (or someone with reassign) can advance the ticket', async () => {
      const created = await create(purchases, { values: { AMOUNT: 1 } }).expect(201);
      const send = purchases.transition['Send to approval']!;
      expect((await move(approver, created.body.id, send, created.body.openVisitId)).status).toBe(404);
      const requesterTry = await move(requester, created.body.id, send, created.body.openVisitId);
      expect(requesterTry.status).toBe(403);
      await move(reviewer, created.body.id, send, created.body.openVisitId).expect(200);
    });

    it('the transition must leave the current step', async () => {
      const created = await create(purchases, { values: { AMOUNT: 1 } }).expect(201);
      const wrong = await move(reviewer, created.body.id, purchases.transition.Approve!, created.body.openVisitId).expect(422);
      expect(wrong.body.error.code).toBe('INVALID_TRANSITION');
      expect((await move(reviewer, created.body.id, purchases.transition['Small']!, created.body.openVisitId).expect(422)).body.error.code).toBe('INVALID_TRANSITION');
    });

    it('a closed ticket cannot move', async () => {
      const created = await create(purchases, { values: { AMOUNT: 500 } }).expect(201);
      const toApproval = await move(reviewer, created.body.id, purchases.transition['Send to approval']!, created.body.openVisitId).expect(200);
      await move(approver, created.body.id, purchases.transition.Approve!, toApproval.body.openVisitId).expect(200);
      expect((await move(approver, created.body.id, purchases.transition.Approve!, toApproval.body.openVisitId).expect(422)).body.error).toMatchObject({ code: 'TICKET_NOT_OPEN', details: { status: 'CLOSED' } });
    });
  });
});

import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

describe('a decision that demands a comment', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let flow: PublishedFlow;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    [requester, worker] = [await world.member(REQUESTER_GRANTS), await world.member(WORKER_GRANTS)];
    flow = await publishFlow(world.admin, {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'review', type: 'APPROVAL', extra: { assignmentMode: 'USERS' }, candidates: [{ participantType: 'USER', userId: worker.userId }] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'review', type: 'DEFAULT' },
        { from: 'review', to: 'end', type: 'DECISION', label: 'Approve' },
        { from: 'review', to: 'end', type: 'DECISION', label: 'Reject', requiresComment: true },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  const create = async () => (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Purchase', values: {} }).expect(201)).body as { id: string; openVisitId: string };
  const take = (ticket: { id: string; openVisitId: string }, label: 'Approve' | 'Reject', comment?: string) =>
    worker.client.post(`/tickets/${ticket.id}/transition`, { transitionId: flow.transition[label], visitId: ticket.openVisitId, ...(comment === undefined ? {} : { comment }) });

  it('the form tells which decisions ask for a comment', async () => {
    const ticket = await create();
    const form = (await worker.client.get(`/tickets/${ticket.id}/form`).expect(200)).body as { decisions: Array<{ label: string; requiresComment: boolean }> };
    expect(Object.fromEntries(form.decisions.map((decision) => [decision.label, decision.requiresComment]))).toEqual({ Approve: false, Reject: true });
  });

  it('is refused without a comment (one that sanitizes to nothing is none) and taken with one; the other decision needs none', async () => {
    const ticket = await create();
    for (const comment of [undefined, '<p> </p>', '<script>x</script>']) {
      const refused = await take(ticket, 'Reject', comment);
      expect([refused.status, refused.body.error.code]).toEqual([422, 'COMMENT_REQUIRED']);
    }
    await take(ticket, 'Reject', '<p>No hay presupuesto</p>').expect(200);
    await take(await create(), 'Approve').expect(200);
  });
});

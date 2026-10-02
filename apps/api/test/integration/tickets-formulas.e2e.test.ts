import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, publishFlow, type PublishedFlow, REQUESTER_GRANTS, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

describe('computed fields: formulas recalculated on creation and on advance', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;
  let quote: PublishedFlow;

  const create = (values: Record<string, unknown>) => requester.client.post('/tickets', { subcategoryId: quote.subcategoryId, title: 'Quote', values });
  const valuesOf = async (ticketId: string) => (await worker.client.get(`/tickets/${ticketId}`).expect(200)).body.values as Record<string, unknown>;

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    [requester, worker] = [await world.member(REQUESTER_GRANTS), await world.member(WORKER_GRANTS)];
    quote = await publishFlow(world.admin, {
      steps: [
        { key: 'start', type: 'START' },
        { key: 'size', type: 'CONDITION' },
        { key: 'review', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [{ participantType: 'USER', userId: worker.userId }] },
        { key: 'end', type: 'END' },
      ],
      transitions: [
        { from: 'start', to: 'size', type: 'DEFAULT' },
        { from: 'size', to: 'review', type: 'CONDITION', label: 'Big', condition: [{ field: 'TOTAL', op: 'gt', value: 1000 }] },
        { from: 'size', to: 'end', type: 'DEFAULT', label: 'Small' },
        { from: 'review', to: 'end', type: 'DECISION', label: 'Done' },
      ],
      fields: [
        { step: 'start', code: 'PRICE', type: 'CURRENCY', capture: 'CREATION', isRequired: true },
        { step: 'start', code: 'QTY', type: 'NUMBER', capture: 'CREATION', isRequired: true },
        { step: 'start', code: 'TOTAL', type: 'FORMULA', capture: 'CREATION', config: { expression: 'ROUND(PRICE * QTY * 1.19, 2)', resultType: 'CURRENCY' } },
        { step: 'start', code: 'UNIT', type: 'FORMULA', capture: 'CREATION', config: { expression: 'TOTAL / QTY', resultType: 'NUMBER', decimals: 3 } },
        { step: 'start', code: 'SAFE_UNIT', type: 'FORMULA', capture: 'CREATION', config: { expression: 'IFERROR(TOTAL / QTY, 0)', resultType: 'NUMBER' } },
      ],
      rules: [{ step: 'start', fieldCode: 'TOTAL', maxAmount: '100000.00', action: 'BLOCK', message: 'Too expensive' }],
    });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('stores the computed values and routes on them', async () => {
    const created = await create({ PRICE: 1000, QTY: 3 }).expect(201);
    expect(await valuesOf(created.body.id)).toEqual({ PRICE: 1000, QTY: 3, TOTAL: 3570, UNIT: 1190, SAFE_UNIT: 1190 });
    expect(created.body.currentStepId).toBe(quote.step.review);
  });

  it('a small total takes the default branch', async () => {
    const created = await create({ PRICE: 100, QTY: 1 }).expect(201);
    expect(created.body.status).toBe('CLOSED');
  });

  it('applies the amount rules to a computed field', async () => {
    const refused = await create({ PRICE: 50000, QTY: 3 }).expect(422);
    expect(refused.body.error).toMatchObject({ code: 'AMOUNT_LIMIT_EXCEEDED', details: { messages: ['Too expensive'] } });
  });

  it('never takes a client value for a computed field', async () => {
    const refused = await create({ PRICE: 1000, QTY: 3, TOTAL: 1 });
    expect(refused.status).toBe(201);
    expect((await valuesOf(refused.body.id)).TOTAL).toBe(3570);
  });

  it('refuses a submission whose captured values break a formula, and writes nothing', async () => {
    const before = Number((await db.platform.query(`SELECT count(*)::int AS n FROM tickets WHERE tenant_id = $1`, [world.tenant.tenantId])).rows[0].n);
    const refused = await create({ PRICE: 1000, QTY: 0 }).expect(422);
    expect(refused.body.error.details.issues).toEqual([{ code: 'FORMULA_ERROR', fieldCode: 'UNIT', reason: 'DIVISION_BY_ZERO' }]);
    const after = Number((await db.platform.query(`SELECT count(*)::int AS n FROM tickets WHERE tenant_id = $1`, [world.tenant.tenantId])).rows[0].n);
    expect(after).toBe(before);
  });
});

import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOf, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, REQUESTER_GRANTS, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const MEALS = { meals: [{ code: 'LUNCH', from: '12:00', to: '14:00', amount: '15000.50' }, { code: 'DINNER', from: '18:00', to: '20:00', amount: '20000' }] };

describe('calculators: tenant settings, publication and the CALCULATOR block', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let requester: Member;
  let worker: Member;

  const tripFlow = (): FlowSpec => ({
    steps: [
      { key: 'start', type: 'START' },
      { key: 'calc', type: 'CALCULATOR', extra: { config: { calculatorCode: 'MEAL_ALLOWANCE', inputs: { departure: 'LEAVES', return: 'BACK' }, outputFieldCode: 'ALLOWANCE' } } },
      { key: 'size', type: 'CONDITION' },
      { key: 'review', type: 'TASK', extra: { assignmentMode: 'USERS' }, candidates: [{ participantType: 'USER', userId: worker.userId }] },
      { key: 'end', type: 'END' },
    ],
    transitions: [
      { from: 'start', to: 'calc', type: 'DEFAULT' },
      { from: 'calc', to: 'size', type: 'DEFAULT' },
      { from: 'size', to: 'review', type: 'CONDITION', label: 'Big', condition: [{ field: 'ALLOWANCE', op: 'gt', value: 30000 }] },
      { from: 'size', to: 'end', type: 'DEFAULT', label: 'Small' },
      { from: 'review', to: 'end', type: 'DECISION', label: 'Done' },
    ],
    fields: [
      { step: 'start', code: 'LEAVES', type: 'DATETIME', capture: 'CREATION', isRequired: true },
      { step: 'start', code: 'BACK', type: 'DATETIME', capture: 'CREATION', isRequired: true },
      { step: 'start', code: 'ALLOWANCE', type: 'CURRENCY', capture: 'CREATION', isReadOnly: true },
    ],
  });

  beforeAll(async () => {
    db = connectTestDatabase();
    ({ app } = await createTestApp());
    world = await TicketWorld.create(db, app);
    [requester, worker] = [await world.member(REQUESTER_GRANTS), await world.member(WORKER_GRANTS)];
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('lists the built-in calculators as off until the tenant configures them', async () => {
    const listed = (await world.admin.get('/calculators').expect(200)).body as Array<{ code: string; configured: boolean; config: unknown }>;
    expect(listed).toEqual([expect.objectContaining({ code: 'MEAL_ALLOWANCE', configured: false, config: null })]);
  });

  it('refuses a version that uses a calculator the tenant has not configured', async () => {
    await expect(publishFlow(world.admin, tripFlow())).rejects.toThrow('CALCULATOR_NOT_CONFIGURED');
  });

  it('validates the configuration with the calculator schema', async () => {
    const invalid = await world.admin.put('/calculators/MEAL_ALLOWANCE/config', { meals: [] }).expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
    await world.admin.put('/calculators/NOPE/config', MEALS).expect(404);
  });

  it('only people allowed to change settings can switch calculators', async () => {
    await requester.client.get('/calculators').expect(403);
    await requester.client.put('/calculators/MEAL_ALLOWANCE/config', MEALS).expect(403);
  });

  it('computes the allowance when the ticket passes the block and routes on it', async () => {
    const saved = (await world.admin.put('/calculators/MEAL_ALLOWANCE/config', MEALS).expect(200)).body;
    expect(saved).toMatchObject({ configured: true, config: MEALS });
    const flow = await publishFlow(world.admin, tripFlow());
    const create = (values: Record<string, unknown>) => requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Trip', values });

    // Mon 11:00 to Tue 21:00 Bogota: lunch+dinner both days = 2 × 35000.50.
    const long = await create({ LEAVES: '2026-10-05T16:00:00.000Z', BACK: '2026-10-07T02:00:00.000Z' }).expect(201);
    expect((await worker.client.get(`/tickets/${long.body.id}`).expect(200)).body.values).toMatchObject({ ALLOWANCE: 70001 });
    expect(long.body.currentStepId).toBe(flow.step.review);
    const events = await world.events(long.body.id);
    expect(events.filter((event) => event.type === 'FIELDS_UPDATED')).toEqual([expect.objectContaining({ actor_id: null, step_id: flow.step.calc, data: { source: 'SYSTEM', changes: [{ code: 'ALLOWANCE', before: null, after: 70001 }] } })]);

    const short = await create({ LEAVES: '2026-10-05T20:30:00.000Z', BACK: '2026-10-05T21:00:00.000Z' }).expect(201);
    expect(short.body.status).toBe('CLOSED');
  });

  it('keeps the ticket moving with a blank when the calculator is switched off later, and records why', async () => {
    const flow = await publishFlow(world.admin, tripFlow());
    await world.admin.delete('/calculators/MEAL_ALLOWANCE/config').expect(200);
    const created = await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Trip', values: { LEAVES: '2026-10-05T16:00:00.000Z', BACK: '2026-10-07T02:00:00.000Z' } }).expect(201);
    expect(created.body.status).toBe('CLOSED');
    expect((await world.events(created.body.id)).filter((event) => event.type === 'SYSTEM').map((event) => event.data)).toEqual([{ kind: 'FORMULA_ERROR', fieldCode: 'ALLOWANCE', reason: 'CALCULATOR_NOT_CONFIGURED' }]);
    await world.admin.put('/calculators/MEAL_ALLOWANCE/config', MEALS).expect(200);
  });

  it('never shows or uses the settings of another tenant (tenant leak test)', async () => {
    const other = await adminOf(db, app, await seedTenant(db.platform));
    expect((await other.admin.get('/calculators').expect(200)).body[0]).toMatchObject({ configured: false, config: null });
    await other.admin.put('/calculators/MEAL_ALLOWANCE/config', { meals: [{ code: 'X', from: '09:00', to: '10:00', amount: '1' }] }).expect(200);
    expect((await world.admin.get('/calculators').expect(200)).body[0].config).toEqual(MEALS);
    await other.admin.delete('/calculators/MEAL_ALLOWANCE/config').expect(200);
    expect((await world.admin.get('/calculators').expect(200)).body[0]).toMatchObject({ configured: true, config: MEALS });
    const rows = await db.platform.query(`SELECT tenant_id FROM calculator_configs WHERE code = 'MEAL_ALLOWANCE'`);
    expect(rows.rows.map((row) => row.tenant_id)).toContain(world.tenant.tenantId);
  });
});

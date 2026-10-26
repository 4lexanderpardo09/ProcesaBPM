import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant } from '@procesabpm/db/testing/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminOf, connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type FlowSpec, type Member, publishFlow, REQUESTER_GRANTS, simpleFlow, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

const RATES = {
  tables: [
    { code: 'COMIDAS', name: 'Comidas', slots: [{ name: 'Almuerzo', from: '12:00', to: '14:00', amount: '15000.50' }, { name: 'Cena', from: '18:00', to: '20:00', amount: '20000' }] },
    { code: 'NOCTURNO', name: 'Recargo nocturno', slots: [{ name: 'Noche', from: '22:00', to: '06:00', amount: '30000' }] },
  ],
};

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
    expect(listed).toEqual([expect.objectContaining({ code: 'TIME_SLOTS', configured: false, config: null })]);
  });

  it('refuses a version that uses a calculator the tenant has not configured', async () => {
    await expect(publishFlow(world.admin, tripFlow())).rejects.toThrow('CALCULATOR_NOT_CONFIGURED');
  });

  it('validates the configuration with the calculator schema', async () => {
    const invalid = await world.admin.put('/calculators/TIME_SLOTS/config', { tables: [] }).expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
    await world.admin.put('/calculators/NOPE/config', RATES).expect(404);
  });

  it('only people allowed to change settings can switch calculators', async () => {
    await requester.client.get('/calculators').expect(403);
    await requester.client.put('/calculators/TIME_SLOTS/config', RATES).expect(403);
  });

  it('computes the allowance when the ticket passes the block and routes on it', async () => {
    const saved = (await world.admin.put('/calculators/TIME_SLOTS/config', RATES).expect(200)).body;
    expect(saved).toMatchObject({ code: 'TIME_SLOTS', configured: true, config: RATES });
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

  it('tells workflow designers the rate tables by name only, never their slots or amounts', async () => {
    await world.admin.put('/calculators/TIME_SLOTS/config', RATES).expect(200);
    expect((await world.admin.get('/calculators/choices').expect(200)).body).toEqual([{ code: 'TIME_SLOTS', tables: [{ code: 'COMIDAS', name: 'Comidas' }, { code: 'NOCTURNO', name: 'Recargo nocturno' }] }]);
    await requester.client.get('/calculators/choices').expect(403);
  });

  it('a field picks one of the organization\'s rate tables; publishing refuses a table it does not have', async () => {
    const shiftFlow = (table: string) => ({
      ...simpleFlow(),
      fields: [
        { step: 'start', code: 'INICIO', type: 'DATETIME', capture: 'CREATION' as const, isRequired: true },
        { step: 'start', code: 'FIN', type: 'DATETIME', capture: 'CREATION' as const, isRequired: true },
        { step: 'start', code: 'RECARGO', type: 'CALCULATOR', capture: 'CREATION' as const, config: { calculatorCode: 'TIME_SLOTS', inputs: { departure: 'INICIO', return: 'FIN' }, table } },
      ],
    });
    await expect(publishFlow(world.admin, shiftFlow('GONE'))).rejects.toThrow('CALCULATOR_TABLE_UNKNOWN');
    const flow = await publishFlow(world.admin, shiftFlow('NOCTURNO'));
    // Mon 11:00 to Tue 13:00 Bogota: the night slot starts once (Monday 22:00).
    const created = (await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Turno', values: { INICIO: '2026-10-05T16:00:00.000Z', FIN: '2026-10-06T18:00:00.000Z' } }).expect(201)).body.id as string;
    expect((await requester.client.get(`/tickets/${created}`).expect(200)).body.values.RECARGO).toBe(30000);
  });

  it('«Días fuera»: the days the person unticks pay no meals, like the help desk', async () => {
    const mealsFlow = {
      ...simpleFlow(),
      fields: [
        { step: 'start', code: 'SALIDA', type: 'DATETIME', capture: 'CREATION' as const, isRequired: true },
        { step: 'start', code: 'REGRESO', type: 'DATETIME', capture: 'CREATION' as const, isRequired: true },
        { step: 'start', code: 'DIAS_FUERA', type: 'TRIP_DAYS', capture: 'CREATION' as const, config: { startFieldCode: 'SALIDA', endFieldCode: 'REGRESO' } },
        { step: 'start', code: 'ALIMENTACION', type: 'CALCULATOR', capture: 'CREATION' as const, config: { calculatorCode: 'TIME_SLOTS', inputs: { departure: 'SALIDA', return: 'REGRESO', daysAtHome: 'DIAS_FUERA' }, table: 'COMIDAS', breakdownFieldCode: 'DETALLE' } },
        { step: 'start', code: 'DETALLE', type: 'TABLE', capture: 'CREATION' as const, isReadOnly: true, config: { columns: [{ code: 'CONCEPTO', label: 'Comida', type: 'TEXT' }, { code: 'CANTIDAD', label: 'Días', type: 'NUMBER' }, { code: 'VALOR_UNIT', label: 'Valor unitario', type: 'CURRENCY' }, { code: 'SUBTOTAL', label: 'Subtotal', type: 'CURRENCY', showTotal: true }] } },
      ],
    };
    await world.admin.put('/calculators/TIME_SLOTS/config', RATES).expect(200);
    const flow = await publishFlow(world.admin, mealsFlow);
    // Mon 11:00 to Wed 21:00 Bogota: lunch and dinner three days; Tuesday unticked.
    const trip = { SALIDA: '2026-10-05T16:00:00.000Z', REGRESO: '2026-10-08T02:00:00.000Z' };
    const created = await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Viaje', values: { ...trip, DIAS_FUERA: ['2026-10-06'] } }).expect(201);
    expect((await requester.client.get(`/tickets/${created.body.id}`).expect(200)).body.values).toMatchObject({
      DIAS_FUERA: ['2026-10-06'],
      ALIMENTACION: 70001,
      DETALLE: [
        { CONCEPTO: 'Almuerzo', CANTIDAD: 2, VALOR_UNIT: 15000.5, SUBTOTAL: 30001 },
        { CONCEPTO: 'Cena', CANTIDAD: 2, VALOR_UNIT: 20000, SUBTOTAL: 40000 },
      ],
    });
    const everyDay = await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Viaje', values: trip }).expect(201);
    expect((await requester.client.get(`/tickets/${everyDay.body.id}`).expect(200)).body.values.ALIMENTACION).toBe(105001.5);
    const wrong = await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Viaje', values: { ...trip, DIAS_FUERA: ['6/10/2026'] } }).expect(422);
    expect(wrong.body.error.code).toBe('FIELD_VALUES_INVALID');
  });

  it('keeps the ticket moving with a blank when the calculator is switched off later, and records why', async () => {
    const flow = await publishFlow(world.admin, tripFlow());
    await world.admin.delete('/calculators/TIME_SLOTS/config').expect(200);
    const created = await requester.client.post('/tickets', { subcategoryId: flow.subcategoryId, title: 'Trip', values: { LEAVES: '2026-10-05T16:00:00.000Z', BACK: '2026-10-07T02:00:00.000Z' } }).expect(201);
    expect(created.body.status).toBe('CLOSED');
    expect((await world.events(created.body.id)).filter((event) => event.type === 'SYSTEM').map((event) => event.data)).toEqual([{ kind: 'FORMULA_ERROR', fieldCode: 'ALLOWANCE', reason: 'CALCULATOR_NOT_CONFIGURED' }]);
    await world.admin.put('/calculators/TIME_SLOTS/config', RATES).expect(200);
  });

  it('never shows or uses the settings of another tenant (tenant leak test)', async () => {
    const other = await adminOf(db, app, await seedTenant(db.platform));
    expect((await other.admin.get('/calculators').expect(200)).body[0]).toMatchObject({ configured: false, config: null });
    await other.admin.put('/calculators/TIME_SLOTS/config', { tables: [{ code: 'X', name: 'X', slots: [{ name: 'X', from: '09:00', to: '10:00', amount: '1' }] }] }).expect(200);
    expect((await world.admin.get('/calculators').expect(200)).body[0].config).toEqual(RATES);
    await other.admin.delete('/calculators/TIME_SLOTS/config').expect(200);
    expect((await world.admin.get('/calculators').expect(200)).body[0]).toMatchObject({ configured: true, config: RATES });
    const rows = await db.platform.query(`SELECT tenant_id FROM calculator_configs WHERE code = 'TIME_SLOTS'`);
    expect(rows.rows.map((row) => row.tenant_id)).toContain(world.tenant.tenantId);
  });
});

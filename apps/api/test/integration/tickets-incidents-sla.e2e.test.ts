import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import type { CreateTicketRequest, TicketMutationResponse, TransitionTicketRequest } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { TenantContext } from '../../src/infrastructure/database/tenant-context.js';
import { CreateTicketService } from '../../src/modules/engine/application/create-ticket.service.js';
import type { TicketActor } from '../../src/modules/engine/application/locked-ticket.js';
import { OpenIncidentService } from '../../src/modules/engine/application/open-incident.service.js';
import { ResolveIncidentService } from '../../src/modules/engine/application/resolve-incident.service.js';
import { TakeTicketService } from '../../src/modules/engine/application/take-ticket.service.js';
import { TransitionTicketService } from '../../src/modules/engine/application/transition-ticket.service.js';
import { SlaOverdueJob } from '../../src/modules/sla/application/sla-overdue.job.js';
import { WorkerModule } from '../../src/worker.module.js';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { TestClock } from '../support/test-clock.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, MONDAY_9AM, publishFlow, type PublishedFlow, simpleFlow, TicketWorld, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

/** Bogotá is UTC-5. Monday 2026-09-07; Wednesday 2026-09-09 is a holiday of the test calendar. */
const bogota = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`);

describe('incidents and the SLA: the pause moves the due date by business time', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let clock: TestClock;
  let worker: Member;
  let helper: Member;
  let hours4: PublishedFlow;
  let hours1: PublishedFlow;
  let days2: PublishedFlow;
  let pool: PublishedFlow;

  const as = <T>(userId: string, work: () => Promise<T>) => app.get(TenantContext).run({ tenantId: world.tenant.tenantId, userId }, work);
  const actor = (userId: string): TicketActor => ({ userId, can: () => Promise.resolve(true), canRead: () => Promise.resolve(true) });
  const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });
  const create = (flow: PublishedFlow, at: Date, extra: Partial<CreateTicketRequest> = {}): Promise<TicketMutationResponse> => {
    clock.set(at);
    return as(worker.userId, () => app.get(CreateTicketService).create({ userId: worker.userId, mayCreate: () => true }, { subcategoryId: flow.subcategoryId, title: 'Request', description: '', values: {}, ...extra }));
  };
  const open = async (ticket: TicketMutationResponse, at: Date, byId = worker.userId) => {
    clock.set(at);
    return as(byId, () => app.get(OpenIncidentService).open(actor(byId), ticket.id, { visitId: ticket.openVisitId!, assignedToId: helper.userId, description: '<p>Paused</p>' }));
  };
  const resolve = (ticket: TicketMutationResponse, incidentId: string, at: Date) => {
    clock.set(at);
    return as(helper.userId, () => app.get(ResolveIncidentService).resolve(actor(helper.userId), ticket.id, incidentId, { resolution: 'Done' }));
  };
  const answer = (ticket: TicketMutationResponse, flow: PublishedFlow, at: Date, userId = worker.userId, extra: Partial<TransitionTicketRequest> = {}) => {
    clock.set(at);
    return as(userId, () => app.get(TransitionTicketService).transition(actor(userId), ticket.id, { transitionId: flow.transition.Done!, visitId: ticket.openVisitId!, values: {}, ...extra }));
  };
  const visit = async (ticketId: string) => (await world.db.platform.query(`SELECT due_at, paused_minutes, business_minutes, result FROM ticket_step_visits WHERE ticket_id = $1 ORDER BY entered_at, id`, [ticketId])).rows;
  const clocks = async (ticketId: string) => (await world.db.platform.query(`SELECT responsible_id, due_at, paused_at, paused_minutes, business_minutes, result, alerted_at, completed_at FROM ticket_sla_clocks WHERE ticket_id = $1 ORDER BY started_at, id`, [ticketId])).rows;

  beforeAll(async () => {
    db = connectTestDatabase();
    clock = new TestClock(MONDAY_9AM);
    ({ app } = await createTestApp({ clock }));
    world = await TicketWorld.create(db, app);
    [worker, helper] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];
    const sla = (value: number, unit: 'BUSINESS_HOURS' | 'BUSINESS_DAYS') => simpleFlow({ assignmentMode: 'USERS', slaValue: value, slaUnit: unit }, { candidates: [user(worker)] });
    [hours4, hours1, days2] = [await publishFlow(world.admin, sla(4, 'BUSINESS_HOURS')), await publishFlow(world.admin, sla(1, 'BUSINESS_HOURS')), await publishFlow(world.admin, sla(2, 'BUSINESS_DAYS'))];
    pool = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS', slaValue: 4, slaUnit: 'BUSINESS_HOURS' }, { candidates: [user(worker), user(helper)] }));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('A. a pause across the night: 8 business hours paused, due moves to the next afternoon', async () => {
    const ticket = await create(hours4, bogota('2026-09-07', '09:00'));
    const { incidentId } = await open(ticket, bogota('2026-09-07', '10:00'));
    expect((await clocks(ticket.id))[0]!.paused_at).toEqual(bogota('2026-09-07', '10:00'));
    await resolve(ticket, incidentId, bogota('2026-09-08', '10:00'));

    const [after] = await clocks(ticket.id);
    expect(after).toMatchObject({ paused_at: null, paused_minutes: 480 });
    expect(after.due_at).toEqual(bogota('2026-09-08', '15:00'));
    expect(await visit(ticket.id)).toMatchObject([{ paused_minutes: 480, due_at: bogota('2026-09-08', '15:00') }]);

    await answer(ticket, hours4, bogota('2026-09-08', '14:30'));
    expect((await clocks(ticket.id))[0]).toMatchObject({ result: 'ON_TIME', business_minutes: 210 });
    expect((await visit(ticket.id))[0]).toMatchObject({ result: 'ON_TIME', business_minutes: 210 });
  });

  it('B. a pause over a weekend (business days): 2 paused hours, due Monday 10:00; late after it', async () => {
    const [onTime, late] = [await create(days2, bogota('2026-09-08', '09:00')), await create(days2, bogota('2026-09-08', '09:00'))];
    expect((await visit(onTime.id))[0]!.due_at).toEqual(bogota('2026-09-11', '18:00'));
    for (const ticket of [onTime, late]) {
      const { incidentId } = await open(ticket, bogota('2026-09-11', '17:00'));
      await resolve(ticket, incidentId, bogota('2026-09-14', '09:00'));
    }
    expect((await clocks(onTime.id))[0]).toMatchObject({ paused_minutes: 120 });
    expect((await clocks(onTime.id))[0]!.due_at).toEqual(bogota('2026-09-14', '10:00'));
    await answer(onTime, days2, bogota('2026-09-14', '09:45'));
    await answer(late, days2, bogota('2026-09-14', '10:30'));
    expect((await visit(onTime.id))[0]!.result).toBe('ON_TIME');
    expect((await visit(late.id))[0]!.result).toBe('LATE');
  });

  it('C. a pause over the holiday does not count the holiday', async () => {
    const ticket = await create(hours4, bogota('2026-09-08', '16:00'));
    expect((await visit(ticket.id))[0]!.due_at).toEqual(bogota('2026-09-10', '10:00'));
    const { incidentId } = await open(ticket, bogota('2026-09-08', '17:00'));
    await resolve(ticket, incidentId, bogota('2026-09-10', '09:00'));
    expect((await clocks(ticket.id))[0]).toMatchObject({ paused_minutes: 120 });
    expect((await clocks(ticket.id))[0]!.due_at).toEqual(bogota('2026-09-10', '12:00'));
  });

  it('G. two incidents add up', async () => {
    const ticket = await create(hours4, bogota('2026-09-07', '09:00'));
    const first = await open(ticket, bogota('2026-09-07', '09:30'));
    await resolve(ticket, first.incidentId, bogota('2026-09-07', '10:30'));
    const second = await open(ticket, bogota('2026-09-07', '11:00'));
    await resolve(ticket, second.incidentId, bogota('2026-09-07', '14:30'));
    expect((await clocks(ticket.id))[0]).toMatchObject({ paused_minutes: 150 });
    expect((await clocks(ticket.id))[0]!.due_at).toEqual(bogota('2026-09-07', '17:30'));
    await answer(ticket, hours4, bogota('2026-09-07', '17:00'));
    expect((await clocks(ticket.id))[0]).toMatchObject({ result: 'ON_TIME', business_minutes: 210 });
  });

  it('D. a pause after the due date moves nothing, the alert is not repeated and the clock stays late', async () => {
    const ticket = await create(hours1, bogota('2026-09-07', '09:00'));
    const workerApp = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(LOG_WRITER).useValue(() => undefined).compile();
    await workerApp.init();
    try {
      const job = workerApp.get(SlaOverdueJob);
      expect(await job.runOnce()).toBeGreaterThan(0);
      const alertedAt = (await clocks(ticket.id))[0]!.alerted_at;
      expect(alertedAt).not.toBeNull();

      const { incidentId } = await open(ticket, bogota('2026-09-07', '11:00'));
      await resolve(ticket, incidentId, bogota('2026-09-08', '09:00'));
      const [after] = await clocks(ticket.id);
      expect(after!.due_at).toEqual(bogota('2026-09-07', '10:00'));
      expect(after).toMatchObject({ paused_minutes: 360 });
      expect(after!.alerted_at).toEqual(alertedAt);
      expect(await job.runOnce()).toBe(0);
    } finally {
      await workerApp.close();
    }
    await answer(ticket, hours1, bogota('2026-09-08', '10:00'));
    expect((await clocks(ticket.id))[0]).toMatchObject({ result: 'LATE', business_minutes: 180 });
  });

  it('a paused clock is never alerted while the incident lasts', async () => {
    const ticket = await create(hours1, bogota('2026-09-07', '09:00'));
    await open(ticket, bogota('2026-09-07', '09:30'));
    const workerApp = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(LOG_WRITER).useValue(() => undefined).compile();
    await workerApp.init();
    try {
      await workerApp.get(SlaOverdueJob).runOnce();
    } finally {
      await workerApp.close();
    }
    expect((await clocks(ticket.id))[0]!.alerted_at).toBeNull();
  });

  it('E. a pool: the pool clock pauses and shifts, and taking the ticket keeps its start', async () => {
    const ticket = await create(pool, bogota('2026-09-07', '09:00'));
    const { incidentId } = await open(ticket, bogota('2026-09-07', '10:00'));
    await resolve(ticket, incidentId, bogota('2026-09-08', '10:00'));
    expect((await world.assignees(ticket.id)).map((row) => row.type)).toEqual(['POOL', 'POOL']);
    const [pooled] = await clocks(ticket.id);
    expect(pooled).toMatchObject({ responsible_id: null, paused_minutes: 480 });
    expect(pooled!.due_at).toEqual(bogota('2026-09-08', '15:00'));

    clock.set(bogota('2026-09-08', '11:00'));
    await as(helper.userId, () => app.get(TakeTicketService).take(actor(helper.userId), ticket.id, { visitId: ticket.openVisitId! }));
    expect((await clocks(ticket.id))[0]).toMatchObject({ responsible_id: helper.userId });
    expect((await world.clocks(ticket.id))[0]!.started_at).toEqual(bogota('2026-09-07', '09:00'));
  });
});

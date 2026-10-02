import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import type { CreateTicketRequest, TicketMutationResponse, TransitionTicketRequest } from '@procesabpm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOG_WRITER } from '../../src/common/logging/json-logger.js';
import { TenantContext } from '../../src/infrastructure/database/tenant-context.js';
import { CreateTicketService } from '../../src/modules/engine/application/create-ticket.service.js';
import type { TicketActor } from '../../src/modules/engine/application/locked-ticket.js';
import { ReassignTicketService } from '../../src/modules/engine/application/reassign-ticket.service.js';
import { TakeTicketService } from '../../src/modules/engine/application/take-ticket.service.js';
import { TransitionTicketService } from '../../src/modules/engine/application/transition-ticket.service.js';
import { SlaOverdueJob } from '../../src/modules/sla/application/sla-overdue.job.js';
import { WorkerModule } from '../../src/worker.module.js';
import { connectTestDatabase } from '../support/admin-api.js';
import { createTestApp } from '../support/create-test-app.js';
import { TestClock } from '../support/test-clock.js';
import { useTestEnvironment } from '../support/test-environment.js';
import { type Member, MONDAY_9AM, publishFlow, type PublishedFlow, simpleFlow, TicketWorld, unique, WORKER_GRANTS } from '../support/ticket-world.js';

useTestEnvironment();

/** Bogotá is UTC-5: `bogota('2026-09-07', '14:30')` is Monday 14:30 local. */
const bogota = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`);

describe('SLA: due dates, clocks and results', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let world: TicketWorld;
  let clock: TestClock;
  let worker: Member;
  let other: Member;

  const context = () => app.get(TenantContext);
  const as = <T>(userId: string, work: () => Promise<T>) => context().run({ tenantId: world.tenant.tenantId, userId }, work);
  const actor = (userId: string, supervisor = false): TicketActor => ({ userId, can: (_tx, _id, action) => Promise.resolve(action !== 'reassign' || supervisor), canRead: () => Promise.resolve(true) });
  const user = (member: Member) => ({ participantType: 'USER', userId: member.userId });
  const create = (flow: PublishedFlow, at: Date, extra: Partial<CreateTicketRequest> = {}): Promise<TicketMutationResponse> => {
    clock.set(at);
    return as(worker.userId, () => app.get(CreateTicketService).create({ userId: worker.userId, mayCreate: () => true }, { subcategoryId: flow.subcategoryId, title: 'Request', description: '', values: {}, attachments: [], companyId: world.tenant.companyId, ...extra }));
  };
  const answer = (ticket: TicketMutationResponse, flow: PublishedFlow, at: Date, label = 'Done', userId = worker.userId, extra: Partial<TransitionTicketRequest> = {}) => {
    clock.set(at);
    return as(userId, () => app.get(TransitionTicketService).transition(actor(userId), ticket.id, { transitionId: flow.transition[label]!, visitId: ticket.openVisitId!, values: {}, attachments: [], ...extra }));
  };
  // The builder API needs a valid token, and tokens read the (fake) clock: every workflow is built before it moves.
  let hours4: PublishedFlow;
  let hours2: PublishedFlow;
  let hours1: PublishedFlow;
  let days2: PublishedFlow;
  let withOverride: PublishedFlow;
  let withoutSla: PublishedFlow;
  let pool: PublishedFlow;
  let looping: PublishedFlow;
  let fastCompany: string;

  beforeAll(async () => {
    db = connectTestDatabase();
    clock = new TestClock(MONDAY_9AM);
    ({ app } = await createTestApp({ clock }));
    world = await TicketWorld.create(db, app);
    [worker, other] = [await world.member(WORKER_GRANTS), await world.member(WORKER_GRANTS)];

    const sla = (value: number, unit: 'BUSINESS_HOURS' | 'BUSINESS_DAYS', extra: Record<string, unknown> = {}) => simpleFlow({ assignmentMode: 'USERS', slaValue: value, slaUnit: unit, ...extra }, { candidates: [user(worker)] });
    [hours4, hours2, hours1, days2] = [await publishFlow(world.admin, sla(4, 'BUSINESS_HOURS')), await publishFlow(world.admin, sla(2, 'BUSINESS_HOURS')), await publishFlow(world.admin, sla(1, 'BUSINESS_HOURS')), await publishFlow(world.admin, sla(2, 'BUSINESS_DAYS'))];
    fastCompany = (await world.admin.post('/companies', { name: unique('Fast'), countryCode: 'CO' }).expect(201)).body.id as string;
    await db.platform.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [world.tenant.tenantId, worker.userId, fastCompany]);
    withOverride = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS', slaValue: 8, slaUnit: 'BUSINESS_HOURS' }, { candidates: [user(worker)], slaOverrides: [{ companyId: fastCompany, slaValue: 1, slaUnit: 'BUSINESS_HOURS' }] }));
    withoutSla = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS' }, { candidates: [user(worker)] }));
    pool = await publishFlow(world.admin, simpleFlow({ assignmentMode: 'USERS', slaValue: 4, slaUnit: 'BUSINESS_HOURS' }, { candidates: [user(worker), user(other)] }));
    const loop = sla(4, 'BUSINESS_HOURS', { maxLoops: 2 });
    looping = await publishFlow(world.admin, { ...loop, transitions: [...loop.transitions, { from: 'task', to: 'task', type: 'DECISION', label: 'Again' }] });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  describe('in business hours', () => {
    it('sets the due date on the visit and the clock, skipping the lunch break', async () => {
      const ticket = await create(hours4, bogota('2026-09-07', '09:00'));
      const [visit] = await world.visits(ticket.id);
      const [openClock] = await world.clocks(ticket.id);
      expect(visit!.due_at).toEqual(bogota('2026-09-07', '15:00'));
      expect(openClock).toMatchObject({ responsible_id: worker.userId, sla_value: 4, sla_unit: 'BUSINESS_HOURS' });
      expect(openClock!.due_at).toEqual(bogota('2026-09-07', '15:00'));
    });

    it('closes on time with the business minutes used', async () => {
      const flow = hours4;
      const ticket = await create(flow, bogota('2026-09-07', '09:00'));
      await answer(ticket, flow, bogota('2026-09-07', '14:30'));
      const [visit] = await world.visits(ticket.id);
      const [closed] = await world.clocks(ticket.id);
      expect([visit!.result, visit!.business_minutes]).toEqual(['ON_TIME', 3 * 60 + 30]);
      expect([closed!.result, closed!.business_minutes]).toEqual(['ON_TIME', 3 * 60 + 30]);
    });

    it('closes late after the due date', async () => {
      const flow = hours4;
      const ticket = await create(flow, bogota('2026-09-07', '09:00'));
      await answer(ticket, flow, bogota('2026-09-07', '16:00'));
      expect((await world.visits(ticket.id))[0]!.result).toBe('LATE');
      expect((await world.clocks(ticket.id))[0]!.result).toBe('LATE');
    });

    it('a ticket created outside working hours starts counting at the next slot', async () => {
      const ticket = await create(hours2, bogota('2026-09-07', '20:00'));
      expect((await world.visits(ticket.id))[0]!.due_at).toEqual(bogota('2026-09-08', '10:00'));
    });
  });

  describe('in business days, with a holiday', () => {
    it('counts to the end of the working day, skipping the Wednesday holiday', async () => {
      const ticket = await create(days2, bogota('2026-09-08', '10:00'));
      expect((await world.visits(ticket.id))[0]!.due_at).toEqual(bogota('2026-09-11', '18:00'));
    });

    it('is on time up to that day and late after it', async () => {
      const flow = days2;
      const onTime = await create(flow, bogota('2026-09-08', '10:00'));
      await answer(onTime, flow, bogota('2026-09-10', '17:00'));
      const late = await create(flow, bogota('2026-09-08', '10:00'));
      await answer(late, flow, bogota('2026-09-14', '09:00'));
      expect((await world.visits(onTime.id))[0]!.result).toBe('ON_TIME');
      expect((await world.visits(late.id))[0]!.result).toBe('LATE');
    });
  });

  describe('company override', () => {
    it('uses the SLA of the company when the step has an override for it', async () => {
      const flow = withOverride;
      const fast = await create(flow, bogota('2026-09-07', '09:00'), { companyId: fastCompany });
      const normal = await create(flow, bogota('2026-09-07', '09:00'), { companyId: world.tenant.companyId });
      expect((await world.clocks(fast.id))[0]).toMatchObject({ sla_value: 1, sla_unit: 'BUSINESS_HOURS' });
      expect((await world.visits(fast.id))[0]!.due_at).toEqual(bogota('2026-09-07', '10:00'));
      expect((await world.clocks(normal.id))[0]).toMatchObject({ sla_value: 8 });
    });

    it('a step without SLA has no due date and no result', async () => {
      const flow = withoutSla;
      const ticket = await create(flow, bogota('2026-09-07', '09:00'));
      await answer(ticket, flow, bogota('2026-09-07', '10:00'));
      expect((await world.visits(ticket.id))[0]).toMatchObject({ due_at: null, result: null, business_minutes: 60 });
    });
  });

  describe('reassignment restarts the responsible\'s clock', () => {
    it('closes the old clock with its result, starts a new one from the reassignment and keeps the visit', async () => {
      const flow = hours4;
      const ticket = await create(flow, bogota('2026-09-07', '09:00'));
      clock.set(bogota('2026-09-07', '11:00'));
      await as(worker.userId, () => app.get(ReassignTicketService).reassign(actor(worker.userId, true), ticket.id, { toUserId: other.userId, visitId: ticket.openVisitId! }));

      const [first, second] = await world.clocks(ticket.id);
      expect([first!.responsible_id, first!.result, first!.business_minutes, first!.completion_reason]).toEqual([worker.userId, 'ON_TIME', 120, 'REASSIGNED']);
      expect(second!.completion_reason).toBeNull();
      expect(second).toMatchObject({ responsible_id: other.userId, completed_at: null, started_at: bogota('2026-09-07', '11:00') });
      expect(second!.due_at).toEqual(bogota('2026-09-07', '17:00'));
      const [visit] = await world.visits(ticket.id);
      expect([visit!.exited_at, visit!.due_at]).toEqual([null, bogota('2026-09-07', '15:00')]);
    });

    it('the new responsible is measured from the reassignment: late for the visit, on time for them', async () => {
      const flow = hours4;
      const ticket = await create(flow, bogota('2026-09-07', '09:00'));
      clock.set(bogota('2026-09-07', '14:00'));
      await as(worker.userId, () => app.get(ReassignTicketService).reassign(actor(worker.userId, true), ticket.id, { toUserId: other.userId, visitId: ticket.openVisitId! }));
      await answer(ticket, flow, bogota('2026-09-07', '16:00'), 'Done', other.userId);
      expect((await world.visits(ticket.id))[0]!.result).toBe('LATE');
      expect((await world.clocks(ticket.id)).map((row) => [row.responsible_id, row.result])).toEqual([[worker.userId, 'ON_TIME'], [other.userId, 'ON_TIME']]);
    });

    it('a pool clock keeps its start when somebody takes the ticket', async () => {
      const flow = pool;
      const ticket = await create(flow, bogota('2026-09-07', '09:00'));
      clock.set(bogota('2026-09-07', '13:00'));
      await as(other.userId, () => app.get(TakeTicketService).take(actor(other.userId), ticket.id, { visitId: ticket.openVisitId! }));
      expect((await world.clocks(ticket.id))[0]).toMatchObject({ responsible_id: other.userId, started_at: bogota('2026-09-07', '09:00') });
    });
  });

  describe('loops', () => {
    it('visiting a step again opens loop 2 with its own visit and clocks, and max_loops is enforced', async () => {
      const flow = looping;
      const first = await create(flow, bogota('2026-09-07', '09:00'));
      const second = await answer(first, flow, bogota('2026-09-07', '10:00'), 'Again');
      expect(await world.ticketRow(first.id)).toMatchObject({ current_loop: 2 });
      expect((await world.visits(first.id)).map((visit) => [visit.loop, visit.exited_at !== null])).toEqual([[1, true], [2, false]]);
      expect((await world.clocks(first.id)).map((row) => [row.loop, row.completed_at !== null])).toEqual([[1, true], [2, false]]);
      expect((await world.visits(first.id))[1]!.due_at).toEqual(bogota('2026-09-07', '16:00'));

      await expect(answer(second, flow, bogota('2026-09-07', '11:00'), 'Again')).rejects.toMatchObject({ code: 'MAX_LOOPS_REACHED' });
      expect(await world.ticketRow(first.id)).toMatchObject({ current_loop: 2, status: 'OPEN' });
      expect((await world.visits(first.id)).filter((visit) => visit.exited_at === null)).toHaveLength(1);
    });
  });

  describe('the overdue job (worker)', () => {
    it('alerts the overdue clocks once, in the outbox of their own tenant', async () => {
      const flow = hours1;
      const ticket = await create(flow, bogota('2026-09-07', '09:00'));
      const clocks = await world.clocks(ticket.id);
      expect(clocks[0]!.due_at!.getTime()).toBeLessThan(Date.now());

      const workerApp = await Test.createTestingModule({ imports: [WorkerModule] }).overrideProvider(LOG_WRITER).useValue(() => undefined).compile();
      await workerApp.init();
      try {
        const job = workerApp.get(SlaOverdueJob);
        expect(await job.runOnce()).toBeGreaterThan(0);
        expect(await job.runOnce()).toBe(0);
      } finally {
        await workerApp.close();
      }
      const alerts = (await db.platform.query<{ tenant_id: string; payload: { ticketId: string } }>(`SELECT tenant_id, payload FROM outbox_events WHERE type = 'sla.overdue' AND payload->>'ticketId' = $1`, [ticket.id])).rows;
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.tenant_id).toBe(world.tenant.tenantId);

      // The clock was alerted; closing it afterwards is unaffected.
      await answer(ticket, flow, bogota('2026-09-07', '11:00'));
      expect((await world.clocks(ticket.id))[0]!.result).toBe('LATE');
    });
  });
});

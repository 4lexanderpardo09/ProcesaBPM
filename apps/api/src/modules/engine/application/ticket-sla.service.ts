import { Inject, Injectable } from '@nestjs/common';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import type { OpenClockRow, OpenVisitRow } from '../data/ticket-write.repository.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { closeSla } from '../../sla/domain/clock-math.js';
import { pausePeriodsOf } from '../../sla/domain/pause-math.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import type { ClosedClock, ClosedVisit } from '../domain/plan.js';

/** Computes how a visit and its clocks ended: business minutes and on time / late, on the calendar they were opened with. */
@Injectable()
export class TicketSlaService {
  constructor(
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
  ) {}

  async closeVisit(
    tx: TenantTransaction,
    tenantId: string,
    ticketId: string,
    company: { readonly timeZone: string },
    visit: OpenVisitRow,
    clocks: readonly OpenClockRow[],
    at: Date,
    exitTransitionId: string | null,
  ): Promise<{ readonly visit: ClosedVisit; readonly clocks: readonly ClosedClock[] }> {
    const resolved = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, visit.calendarId, visit.enteredAt);
    const calendar = resolved?.calendar ?? null;
    // Every incident of the ticket: a pause outside a clock's own span changes nothing in the math, and no clock
    // or visit can start while the ticket is paused, so there is no need to filter them.
    const pauses = pausePeriodsOf(await this.writes.findIncidentPeriods(tx, tenantId, ticketId), at);
    const closedVisit = closeSla({ startedAt: visit.enteredAt, completedAt: at, dueAt: visit.dueAt, calendar, pauses });
    return {
      visit: { visitId: visit.id, exitTransitionId, ...closedVisit },
      clocks: clocks.map((clock) => ({ clockId: clock.id, ...closeSla({ startedAt: clock.startedAt, completedAt: at, dueAt: clock.dueAt, calendar, pauses }) })),
    };
  }

  /** Clocks only (a reassignment closes the responsible's clock and leaves the visit alone). */
  async closeClocks(tx: TenantTransaction, tenantId: string, ticketId: string, company: { readonly timeZone: string }, visit: OpenVisitRow, clocks: readonly OpenClockRow[], at: Date): Promise<readonly ClosedClock[]> {
    return (await this.closeVisit(tx, tenantId, ticketId, company, visit, clocks, at, null)).clocks;
  }
}

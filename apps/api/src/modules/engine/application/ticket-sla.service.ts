import { Inject, Injectable } from '@nestjs/common';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import type { OpenClockRow, OpenVisitRow } from '../data/ticket-write.repository.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { closeSla } from '../../sla/domain/clock-math.js';
import type { ClosedClock, ClosedVisit } from '../domain/plan.js';

/** Computes how a visit and its clocks ended: business minutes and on time / late, on the calendar they were opened with. */
@Injectable()
export class TicketSlaService {
  constructor(@Inject(TicketContextRepository) private readonly people: TicketContextRepository) {}

  async closeVisit(
    tx: TenantTransaction,
    tenantId: string,
    company: { readonly timeZone: string },
    visit: OpenVisitRow,
    clocks: readonly OpenClockRow[],
    at: Date,
    exitTransitionId: string | null,
  ): Promise<{ readonly visit: ClosedVisit; readonly clocks: readonly ClosedClock[] }> {
    const resolved = await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, visit.calendarId, visit.enteredAt);
    const calendar = resolved?.calendar ?? null;
    const closedVisit = closeSla({ startedAt: visit.enteredAt, completedAt: at, dueAt: visit.dueAt, calendar });
    return {
      visit: { visitId: visit.id, exitTransitionId, ...closedVisit },
      clocks: clocks.map((clock) => ({ clockId: clock.id, ...closeSla({ startedAt: clock.startedAt, completedAt: at, dueAt: clock.dueAt, calendar }) })),
    };
  }

  /** Clocks only (a reassignment closes the responsible's clock and leaves the visit alone). */
  async closeClocks(tx: TenantTransaction, tenantId: string, company: { readonly timeZone: string }, visit: OpenVisitRow, clocks: readonly OpenClockRow[], at: Date): Promise<readonly ClosedClock[]> {
    return (await this.closeVisit(tx, tenantId, company, visit, clocks, at, null)).clocks;
  }
}

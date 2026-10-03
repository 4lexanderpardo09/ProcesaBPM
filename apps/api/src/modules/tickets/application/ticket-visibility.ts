import { Inject, Injectable } from '@nestjs/common';
import type { TicketRealtimeSummary } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { TicketQueryRepository } from '../data/ticket-query.repository.js';
import { readableTickets } from './ticket-access.js';

type SummaryRow = NonNullable<Awaited<ReturnType<TicketQueryRepository['findRealtimeSummary']>>>;

const toSummary = (row: SummaryRow): TicketRealtimeSummary => ({
  ticketId: row.id,
  status: row.status,
  currentStepId: row.currentStepId,
  currentLoop: row.currentLoop,
  assignees: row.assignees.map((assignee) => ({ userId: assignee.userId, type: assignee.type })),
  lastEventSeq: (row.events[0]?.seq ?? 0n).toString(),
});

/**
 * "May this member read this ticket right now?" for callers outside an HTTP request (real time). Each question runs in
 * a transaction of THAT member's tenant and user (row-level security) with the same access filter as `GET /tickets/:id`
 * (`readableTickets`), evaluated by the database. An unreadable, foreign or missing ticket all answer the same.
 */
@Injectable()
export class TicketVisibility {
  constructor(
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TicketQueryRepository) private readonly tickets: TicketQueryRepository,
  ) {}

  async summaryIfReadable(principal: Principal, ability: AppAbility, ticketId: string): Promise<TicketRealtimeSummary | undefined> {
    const row = await this.asMember(principal, (tx) => this.tickets.findRealtimeSummary(tx, principal.tenantId, ticketId, readableTickets(ability)));
    return row === null ? undefined : toSummary(row);
  }

  async readableIds(principal: Principal, ability: AppAbility, ticketIds: readonly string[]): Promise<Set<string>> {
    if (ticketIds.length === 0) return new Set();
    return new Set(await this.asMember(principal, (tx) => this.tickets.readableIds(tx, principal.tenantId, ticketIds, readableTickets(ability))));
  }

  private asMember<T>(principal: Principal, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.context.run({ tenantId: principal.tenantId, userId: principal.userId }, () => this.runner.withTenantTransaction(work));
  }
}

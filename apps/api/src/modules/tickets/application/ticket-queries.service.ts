import { Inject, Injectable } from '@nestjs/common';
import {
  type ListTicketsQuery,
  NotFoundError,
  type Page,
  type TicketCountsResponse,
  type TicketDetailResponse,
  type TicketEventResponse,
  type TicketFiltersQuery,
  type TicketSummaryResponse,
  type TicketView,
} from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { pageWindow } from '../../../common/crud/pagination.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { TicketQueryRepository, type Where } from '../data/ticket-query.repository.js';
import { ticketFilters, viewFilter } from '../domain/ticket-list-filters.js';
import { valueNamesOf, valueReferences } from '../domain/value-references.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { TicketActor } from '../../engine/application/locked-ticket.js';
import { TicketActionStateReader } from '../../engine/application/ticket-action-state.reader.js';
import { ticketActionsOf } from '../../engine/domain/ticket-actions.js';
import { readableTickets, ticketActorOf } from './ticket-access.js';
import { type TicketDetailBody, toDetail, toEvent, toSummary } from './ticket-responses.js';

/** The read side of tickets. A ticket the caller may not read answers exactly like one that does not exist. */
@Injectable()
export class TicketQueriesService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TicketQueryRepository) private readonly tickets: TicketQueryRepository,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(TicketActionStateReader) private readonly actionStates: TicketActionStateReader,
  ) {}

  /** The detail and what the caller may do with the ticket now, judged by the engine's own action rules. */
  get(ability: AppAbility, ticketId: string, userId: string): Promise<TicketDetailResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.context.require().tenantId;
      const body = await this.bodyOf(tx, tenantId, ability, ticketId, userId);
      const state = await this.actionStates.read(tx, tenantId, ticketId, ticketActorOf({ userId }, ability, tenantId, this.tickets));
      if (state === null) throw new NotFoundError();
      return { ...body, actions: ticketActionsOf(state) };
    });
  }

  /** The detail without the caller's actions, for reads that only need the ticket's state (they cost a query per permission). */
  getBody(ability: AppAbility, ticketId: string, userId: string): Promise<TicketDetailBody> {
    return this.runner.withTenantTransaction((tx) => this.bodyOf(tx, this.context.require().tenantId, ability, ticketId, userId));
  }

  /** The caller as the engine needs them to act on tickets. */
  actorFor(principal: Principal, ability: AppAbility): TicketActor {
    return ticketActorOf(principal, ability, this.context.require().tenantId, this.tickets);
  }

  list(principal: Principal, ability: AppAbility, query: ListTicketsQuery): Promise<Page<TicketSummaryResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.tickets.list(tx, this.context.require().tenantId, this.filtersFor(principal, ability, query.view, query), pageWindow(query), principal.userId);
      const now = this.clock.now();
      return { items: rows.map((row) => toSummary(row, now)), page: query.page, pageSize: query.pageSize, total };
    });
  }

  /** The total of every view under the same filters as the listing: one count per view, so the web does not fetch four pages. */
  counts(principal: Principal, ability: AppAbility, query: TicketFiltersQuery): Promise<TicketCountsResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.context.require().tenantId;
      const count = (view: TicketView) => this.tickets.count(tx, tenantId, this.filtersFor(principal, ability, view, query));
      // One query after another: an interactive transaction has a single connection.
      return { assigned: await count('assigned'), created: await count('created'), observed: await count('observed'), all: await count('all') };
    });
  }

  timeline(ability: AppAbility, ticketId: string): Promise<TicketEventResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      const events = await this.tickets.findTimeline(tx, this.context.require().tenantId, ticketId, readableTickets(ability));
      if (events === undefined) throw new NotFoundError();
      return events.map(toEvent);
    });
  }

  private async bodyOf(tx: TenantTransaction, tenantId: string, ability: AppAbility, ticketId: string, userId: string): Promise<TicketDetailBody> {
    const row = await this.tickets.findDetail(tx, tenantId, ticketId, readableTickets(ability), userId);
    if (row === null) throw new NotFoundError();
    const references = valueReferences(row.fieldValues);
    // One query after another: an interactive transaction has a single connection.
    const names = { users: await this.tickets.memberNames(tx, tenantId, references.users), sites: await this.tickets.siteNames(tx, tenantId, references.sites) };
    return toDetail(row, this.clock.now(), valueNamesOf(references, names));
  }

  /** The view, the inbox filters and the access filter, all in one `AND`: what was asked can only narrow what may be read. */
  private filtersFor(principal: Principal, ability: AppAbility, view: TicketView, query: TicketFiltersQuery): Where[] {
    return [viewFilter(view, { userId: principal.userId, membership: principal.membership }), ...ticketFilters(query), readableTickets(ability)];
  }
}

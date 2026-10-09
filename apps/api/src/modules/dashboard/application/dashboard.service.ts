import { Inject, Injectable } from '@nestjs/common';
import type { DashboardStatsResponse, PendingTicketResponse } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { accessibleWhere } from '../../authorization/domain/record-access.js';
import { TICKET_READ_ACTIONS, TICKET_SUBJECT } from '../../tickets/domain/ticket-subject.js';
import { DashboardRepository } from '../data/dashboard.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const PENDING_LIMIT = 100;

/** The member's own overview: counters and the tickets waiting on them, all within what they may read. */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(DashboardRepository) private readonly repository: DashboardRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  stats(ability: AppAbility): Promise<DashboardStatsResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId, userId } = this.context.require();
      const access = accessibleWhere(ability, TICKET_READ_ACTIONS, TICKET_SUBJECT);
      const now = this.clock.now();
      const soon = new Date(now.getTime() + DAY_MS);
      const weekAgo = new Date(now.getTime() - WEEK_MS);
      const assigned = { assignees: { some: { tenantId, userId } } };
      const running = { responsibleId: userId, completedAt: null, pausedAt: null };
      const [myOpen, myOverdue, myDueSoon, createdByMeOpen, closedByMeWeek] = await Promise.all([
        // Open or paused: the same tickets as the pending list, so the card and the list agree.
        this.repository.count(tx, tenantId, [access, { status: { in: ['OPEN', 'PAUSED'] }, ...assigned }]),
        this.repository.count(tx, tenantId, [access, { status: 'OPEN', ...assigned, slaClocks: { some: { ...running, dueAt: { lt: now } } } }]),
        this.repository.count(tx, tenantId, [access, { status: 'OPEN', ...assigned, slaClocks: { some: { ...running, dueAt: { gte: now, lte: soon } } } }]),
        this.repository.count(tx, tenantId, [access, { status: 'OPEN', creatorId: userId }]),
        this.repository.count(tx, tenantId, [access, { status: 'CLOSED', closedById: userId, closedAt: { gte: weekAgo } }]),
      ]);
      return { myOpen, myOverdue, myDueSoon, createdByMeOpen, closedByMeWeek };
    });
  }

  pending(ability: AppAbility): Promise<PendingTicketResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId, userId } = this.context.require();
      const access = accessibleWhere(ability, TICKET_READ_ACTIONS, TICKET_SUBJECT);
      const now = this.clock.now().getTime();
      const rows = await this.repository.pending(tx, tenantId, userId, access, PENDING_LIMIT);
      // Already most urgent first (the repository orders before the limit); a ticket with no SLA goes last.
      return rows.map((row) => ({
        id: row.id,
        number: row.number.toString(),
        title: row.title,
        status: row.status,
        currentStepId: row.currentStepId,
        createdAt: row.createdAt.toISOString(),
        dueAt: row.dueAt?.toISOString() ?? null,
        overdue: row.dueAt !== null && row.dueAt.getTime() < now,
      }));
    });
  }
}

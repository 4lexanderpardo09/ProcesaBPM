/** The signed-in member's own counters. Everything is scoped to what they may read. */
export interface DashboardStatsResponse {
  /** Open tickets assigned to them. */
  readonly myOpen: number;
  /** Of those, the ones past their SLA. */
  readonly myOverdue: number;
  /** Of those, the ones due within the next 24 hours. */
  readonly myDueSoon: number;
  /** Open tickets they created. */
  readonly createdByMeOpen: number;
  /** Tickets they closed in the last 7 days. */
  readonly closedByMeWeek: number;
}

/** A ticket waiting on the member, ordered by how soon it is due. */
export interface PendingTicketResponse {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly status: 'OPEN' | 'PAUSED' | 'CLOSED';
  readonly currentStepId: string | null;
  readonly createdAt: string;
  readonly dueAt: string | null;
  readonly overdue: boolean;
}

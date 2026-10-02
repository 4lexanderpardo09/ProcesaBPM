import type { SlaTerms } from '../../sla/domain/clock-math.js';

export type SlaResultValue = 'ON_TIME' | 'LATE';

export interface VisitPlan {
  readonly stepId: string;
  readonly loop: number;
  readonly enteredAt: Date;
  readonly sla: SlaTerms;
  readonly calendarId: string | null;
  readonly dueAt: Date | null;
}

export interface ClockPlan {
  /** `null` for a pool: nobody is responsible until someone takes the ticket. */
  readonly responsibleId: string | null;
  readonly startedAt: Date;
  readonly sla: SlaTerms;
  readonly calendarId: string | null;
  readonly dueAt: Date | null;
}

export type AssigneeKind = 'PRIMARY' | 'POOL' | 'PARALLEL' | 'INCIDENT';

export interface AssigneePlan {
  readonly userId: string;
  readonly type: AssigneeKind;
}

/** Work for the outbox; the applier adds the id of the event it belongs to (`eventId`) to the payload. */
export interface OutboxIntent {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type EventType = 'CREATED' | 'TRANSITIONED' | 'COMMENTED' | 'ASSIGNED' | 'REASSIGNED' | 'CLOSED' | 'AMOUNT_WARNING' | 'FIELDS_UPDATED' | 'INCIDENT_OPENED' | 'INCIDENT_RESOLVED' | 'REOPENED' | 'PARALLEL_TASK_COMPLETED' | 'SYSTEM';

/** Uploads a movement attaches to the ticket, written right after its event (which they point to). */
export interface AttachmentsPlan {
  readonly stepId: string | null;
  readonly role: 'ATTACHMENT' | 'CLOSING';
  readonly attachmentIds: readonly string[];
  readonly fieldFiles: ReadonlyArray<{ readonly fieldCode: string; readonly added: readonly string[]; readonly removed: readonly string[] }>;
}

export interface EventPlan {
  readonly type: EventType;
  readonly stepId?: string | null;
  readonly transitionId?: string | null;
  readonly loop: number;
  readonly actorId: string | null;
  readonly assigneeId?: string | null;
  readonly commentHtml?: string | null;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly outbox?: readonly OutboxIntent[];
  readonly attachments?: AttachmentsPlan | undefined;
}

export interface ClosedClock {
  readonly clockId: string;
  readonly businessMinutes: number | null;
  readonly result: SlaResultValue | null;
}

export interface ClosedVisit {
  readonly visitId: string;
  readonly exitTransitionId: string | null;
  readonly businessMinutes: number | null;
  readonly result: SlaResultValue | null;
}

/** Where the ticket arrives after a movement: a people step with its visit, clocks and assignees. */
export interface ArrivalPlan {
  readonly visit: VisitPlan;
  readonly clocks: readonly ClockPlan[];
  readonly assignees: readonly AssigneePlan[];
  /** People who each have a signature to give in a PARALLEL step (one `ticket_parallel_tasks` row each). */
  readonly parallelTasks: readonly string[];
}

export interface FieldWrite {
  readonly fieldId: string;
  readonly value: unknown;
}

/**
 * Everything one use case changes, computed before anything is written (so every validation error comes
 * first). The applier writes it in the order the database constraints need: clocks and visit are closed
 * before the next visit opens, assignees are replaced, then the ticket row, then events and outbox.
 */
export interface TicketMutation {
  readonly at: Date;
  readonly actorId: string;
  readonly fieldWrites: readonly FieldWrite[];
  readonly closing?: { readonly visit: ClosedVisit; readonly clocks: readonly ClosedClock[] };
  readonly arrival?: ArrivalPlan;
  /** `current` moves the ticket to a people step; `closed` ends it. */
  readonly ticket:
    | { readonly kind: 'current'; readonly stepId: string; readonly loop: number }
    | { readonly kind: 'closed'; readonly stepId: string | null }
    | { readonly kind: 'reopened'; readonly stepId: string; readonly loop: number };
  readonly events: readonly EventPlan[];
}

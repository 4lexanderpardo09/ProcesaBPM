import { DomainError, InvalidStateError, MAX_BATCH_TICKETS, PermissionDeniedError, type StepDocument } from '@procesabpm/shared';
import type { AssigneeType, TicketStatus } from './ticket-action-rules.js';

/** How many tickets of one step a batch may move: the step's own limit, never more than a request carries. */
export function batchLimitOf(step: StepDocument): number {
  const configured = (step.config.batch as { maxTickets?: unknown } | undefined)?.maxTickets;
  return typeof configured === 'number' && configured >= 1 ? Math.min(configured, MAX_BATCH_TICKETS) : MAX_BATCH_TICKETS;
}

export interface BatchCandidate {
  readonly status: TicketStatus;
  /** The current step, `undefined` when the ticket is not on one. */
  readonly step: StepDocument | undefined;
  /** The caller's own place on the ticket. */
  readonly ownType: AssigneeType | undefined;
  /** How many tickets of the request are on the same step. */
  readonly sameStepCount: number;
}

/**
 * Why one ticket cannot go in a batch, before trying its transition: it must be open on a step that allows batches,
 * held by the caller (a supervisor answers tickets one by one), and its step's limit must fit the request.
 */
export function batchRefusal(candidate: BatchCandidate): DomainError | null {
  if (candidate.status !== 'OPEN' || candidate.step === undefined) return new InvalidStateError('The ticket is not open on a step');
  if (!candidate.step.allowsBatch) return new InvalidStateError('The step of this ticket is not answered in batches');
  if (candidate.ownType !== 'PRIMARY' && candidate.ownType !== 'POOL') return new PermissionDeniedError('Only whoever holds the ticket answers it in a batch');
  if (candidate.sameStepCount > batchLimitOf(candidate.step)) return new InvalidStateError(`The step takes at most ${String(batchLimitOf(candidate.step))} tickets per batch`);
  return null;
}

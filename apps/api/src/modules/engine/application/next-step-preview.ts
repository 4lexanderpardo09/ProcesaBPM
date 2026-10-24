import { captureFieldsFor, DomainError, ERROR_CODES, type ErrorCode, type TransitionPreviewResponse, type WorkflowVersionDocument } from '@procesabpm/shared';
import type { ArrivalPreview } from './arrival-planner.js';

/**
 * The errors that say the workflow cannot go on from here, whatever the person types: a preview answers them as
 * `BLOCKED` (so the dialog warns before the answer is sent) instead of failing.
 */
const BLOCKING_CODES: ReadonlySet<ErrorCode> = new Set([
  ERROR_CODES.noAssigneeCandidates,
  ERROR_CODES.noMatchingBranch,
  ERROR_CODES.maxLoopsReached,
  ERROR_CODES.approverNotFound,
  ERROR_CODES.invalidCalendar,
  ERROR_CODES.exportCutoffPending,
]);

const EMPTY = { via: [], step: null, assignment: null, people: [], fields: [], resumeAt: null, blocked: null } as const;

/** What a preview of the arrival says to the person: the blocks on the way, the step, who gets it and what is filled there. */
export function previewResponse(arrival: ArrivalPreview, document: WorkflowVersionDocument): TransitionPreviewResponse {
  const nameOf = new Map(document.steps.map((step) => [step.id, step.name]));
  // The START block is where a new ticket begins, not a block it passes through.
  const via = arrival.hops.filter((hop) => hop.blockType !== 'START').map((hop) => ({ name: nameOf.get(hop.stepId) ?? '', blockType: hop.blockType }));
  if (arrival.kind === 'END') return { ...EMPTY, outcome: 'END', via };
  const step = { id: arrival.step.id, name: arrival.step.name, type: arrival.step.type };
  if (arrival.kind === 'WAIT') return { ...EMPTY, outcome: 'WAIT', via, step, resumeAt: arrival.resumeAt.toISOString() };
  return {
    ...EMPTY,
    outcome: 'STEP',
    via,
    step,
    assignment: arrival.assignment,
    people: arrival.people.map((person) => ({ id: person.userId, name: person.name })),
    fields: captureFieldsFor(document.fields, 'STEP', arrival.step.id).map((field) => field.label),
  };
}

/** Runs a preview; an error that blocks the workflow becomes a `BLOCKED` answer, any other one is thrown as is. */
export async function previewOrBlocked(run: () => Promise<TransitionPreviewResponse>): Promise<TransitionPreviewResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DomainError && BLOCKING_CODES.has(error.code)) return { ...EMPTY, outcome: 'BLOCKED', blocked: { code: error.code, details: error.details ?? null } };
    throw error;
  }
}

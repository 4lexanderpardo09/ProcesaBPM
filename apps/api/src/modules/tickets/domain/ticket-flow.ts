import type { TicketFlowResponse, WorkflowVersionDocument } from '@procesabpm/shared';

/** What the ticket's history records about its way through the version. */
export interface TicketProgress {
  readonly ticketId: string;
  readonly versionId: string;
  readonly status: TicketFlowResponse['status'];
  readonly currentStepId: string | null;
  /** The step of every visit (people steps and WAIT blocks; a loop or a reopening is another visit). */
  readonly visitedStepIds: readonly string[];
  /** Every transition the ticket went along, by people or by the engine through automatic blocks. */
  readonly takenTransitionIds: readonly string[];
}

const countOf = (ids: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
};

/**
 * The version's graph with the ticket's progress on it, and nothing else of the version. Automatic blocks have no
 * visits, END is never left and a reopening enters a step without a transition, so the passes through a block are the
 * largest of its visits, the transitions taken into it and the ones taken out of it.
 */
export function ticketFlowOf(document: WorkflowVersionDocument, progress: TicketProgress): TicketFlowResponse {
  const known = new Map(document.transitions.map((transition) => [transition.id, transition]));
  const taken = countOf(progress.takenTransitionIds.filter((id) => known.has(id)));
  const visits = countOf(progress.visitedStepIds);
  const entered = new Map<string, number>();
  const left = new Map<string, number>();
  for (const [transitionId, times] of taken) {
    const transition = known.get(transitionId)!;
    entered.set(transition.toStepId, (entered.get(transition.toStepId) ?? 0) + times);
    left.set(transition.fromStepId, (left.get(transition.fromStepId) ?? 0) + times);
  }
  return {
    ticketId: progress.ticketId,
    versionId: progress.versionId,
    status: progress.status,
    currentStepId: progress.status === 'CLOSED' ? null : progress.currentStepId,
    steps: document.steps.map((step) => ({
      id: step.id,
      type: step.type,
      name: step.name,
      position: { x: step.ui.x, y: step.ui.y },
      passCount: Math.max(visits.get(step.id) ?? 0, entered.get(step.id) ?? 0, left.get(step.id) ?? 0),
    })),
    transitions: document.transitions.map((transition) => ({
      id: transition.id,
      fromStepId: transition.fromStepId,
      toStepId: transition.toStepId,
      type: transition.type,
      label: transition.label,
      points: transition.uiPoints === null ? null : transition.uiPoints.map((point) => ({ x: point.x, y: point.y })),
      takenCount: taken.get(transition.id) ?? 0,
    })),
  };
}

import type { FlowPoint, TicketFlowResponse } from '@procesabpm/shared';

/** Where the ticket stands on a block: it went through it, it is on it now, or it has not got there. */
export type FlowStepState = 'done' | 'current' | 'pending';

/** A connection the ticket went along, the way out of the current block, or one not taken. */
export type FlowTransitionState = 'taken' | 'next' | 'pending';

export interface DiagramStep {
  readonly id: string;
  readonly type: TicketFlowResponse['steps'][number]['type'];
  readonly name: string;
  readonly position: FlowPoint;
  readonly state: FlowStepState;
  readonly passCount: number;
}

export interface DiagramTransition {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string;
  readonly points: readonly FlowPoint[] | null;
  readonly state: FlowTransitionState;
  /** It goes back to a block drawn further left: a retry, drawn dashed. */
  readonly retry: boolean;
}

export interface FlowDiagram {
  readonly steps: readonly DiagramStep[];
  readonly transitions: readonly DiagramTransition[];
}

/** The ticket's progress as the diagram draws it (README "Flujos": done, current and pending; retries dashed). */
export function flowDiagram(flow: TicketFlowResponse): FlowDiagram {
  const current = flow.status === 'CLOSED' ? null : flow.currentStepId;
  const steps = flow.steps.map((step) => ({ ...step, state: stepState(step.id, step.passCount, current) }));
  const positions = new Map(flow.steps.map((step) => [step.id, step.position]));
  const transitions = flow.transitions.map((transition) => ({
    id: transition.id,
    source: transition.fromStepId,
    target: transition.toStepId,
    label: transition.label,
    points: transition.points,
    state: transitionState(transition.fromStepId, transition.takenCount, current),
    retry: (positions.get(transition.toStepId)?.x ?? 0) < (positions.get(transition.fromStepId)?.x ?? 0),
  }));
  return { steps, transitions };
}

function stepState(stepId: string, passCount: number, current: string | null): FlowStepState {
  if (stepId === current) return 'current';
  return passCount > 0 ? 'done' : 'pending';
}

function transitionState(fromStepId: string, takenCount: number, current: string | null): FlowTransitionState {
  if (fromStepId === current) return 'next';
  return takenCount > 0 ? 'taken' : 'pending';
}

import type { FlowPoint, TicketFlowResponse } from '@procesabpm/shared';
import { layeredLayout, parallelOffsets } from '@/shared/lib/flow-layout';

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
  readonly state: FlowTransitionState;
  /** It goes back to a block drawn further left: a retry, drawn dashed. */
  readonly retry: boolean;
  /** How far it is pushed aside from the other connections joining the same two blocks. */
  readonly offset: number;
}

export interface FlowDiagram {
  readonly steps: readonly DiagramStep[];
  readonly transitions: readonly DiagramTransition[];
}

/** The size a block is laid out at in the ticket's diagram (its card is 168px wide and about 60px high). */
const BLOCK_WIDTH = 168;
const BLOCK_HEIGHT = 72;

/**
 * The ticket's progress as the diagram draws it (README "Flujos": done, current and pending; retries dashed). The blocks
 * are laid out here, left to right with as few crossings as possible, rather than where the builder left them: whoever
 * follows a ticket sees a clean flow even when nobody arranged the version, as the help desk shows it.
 */
export function flowDiagram(flow: TicketFlowResponse): FlowDiagram {
  const current = flow.status === 'CLOSED' ? null : flow.currentStepId;
  const links = flow.transitions.map((transition) => ({ id: transition.id, from: transition.fromStepId, to: transition.toStepId }));
  const positions = layeredLayout(flow.steps.map((step) => ({ id: step.id, width: BLOCK_WIDTH, height: BLOCK_HEIGHT })), links);
  const offsets = parallelOffsets(links);
  const at = (stepId: string): FlowPoint => positions.get(stepId) ?? { x: 0, y: 0 };
  const steps = flow.steps.map((step) => ({ ...step, position: at(step.id), state: stepState(step.id, step.passCount, current) }));
  const transitions = flow.transitions.map((transition) => ({
    id: transition.id,
    source: transition.fromStepId,
    target: transition.toStepId,
    label: transition.label,
    state: transitionState(transition.fromStepId, transition.takenCount, current),
    retry: at(transition.toStepId).x <= at(transition.fromStepId).x,
    offset: offsets.get(transition.id) ?? 0,
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

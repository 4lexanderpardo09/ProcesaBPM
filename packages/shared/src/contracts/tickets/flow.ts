import { z } from 'zod';
import { STEP_TYPES, type StepType, TRANSITION_TYPES, type TransitionType } from '../../workflow/constants.js';
import { uuidSchema } from '../ids.js';
import { ticketStatusSchema } from './schemas.js';

/**
 * The diagram of a ticket's progress ("Avance del flujo"): the graph of the version the ticket runs on and how far it
 * got. For whoever may read the ticket, so it carries only what a diagram draws: no field configuration, assignment
 * or approver rules, transition conditions or block settings (webhook addresses and the like).
 */

export interface FlowPoint {
  readonly x: number;
  readonly y: number;
}

export interface TicketFlowStepResponse {
  readonly id: string;
  readonly type: StepType;
  readonly name: string;
  /** Where the builder placed the block. */
  readonly position: FlowPoint;
  /** How many times the ticket went through the block (each loop counts again); 0 when it never got there. */
  readonly passCount: number;
}

export interface TicketFlowTransitionResponse {
  readonly id: string;
  readonly fromStepId: string;
  readonly toStepId: string;
  readonly type: TransitionType;
  /** The decision's name for people steps, the branch's name for conditions. */
  readonly label: string;
  /** The bend points the builder drew, or `null` for a straight line. */
  readonly points: readonly FlowPoint[] | null;
  /** How many times the ticket went along it; 0 when never. */
  readonly takenCount: number;
}

/** One time the ticket was on a people step or a WAIT block, with its deadline and whether it was left in time. */
export interface TicketFlowVisitResponse {
  readonly stepId: string;
  /** 1 the first time; each loop back or reopening adds one. */
  readonly loop: number;
  readonly enteredAt: string;
  /** `null` while the ticket is still there. */
  readonly exitedAt: string | null;
  /** `null` when the step has no deadline. */
  readonly dueAt: string | null;
  /** Set when the visit ends on a step with a deadline. */
  readonly result: 'ON_TIME' | 'LATE' | null;
}

export interface TicketFlowResponse {
  readonly ticketId: string;
  readonly versionId: string;
  readonly status: 'OPEN' | 'PAUSED' | 'CLOSED';
  /** The block the ticket is on now; `null` once it is closed. */
  readonly currentStepId: string | null;
  readonly steps: readonly TicketFlowStepResponse[];
  readonly transitions: readonly TicketFlowTransitionResponse[];
  /** Every visit, oldest first: the times per step ("a tiempo" / "tarde"). */
  readonly visits: readonly TicketFlowVisitResponse[];
}

const flowPointSchema = z.object({ x: z.number(), y: z.number() }) satisfies z.ZodType<FlowPoint>;

/** Parses `TicketFlowResponse` (for the web client); `satisfies` keeps it in step with the interface. */
export const ticketFlowResponseSchema = z.object({
  ticketId: uuidSchema,
  versionId: uuidSchema,
  status: ticketStatusSchema,
  currentStepId: uuidSchema.nullable(),
  steps: z.array(z.object({ id: uuidSchema, type: z.enum(STEP_TYPES), name: z.string(), position: flowPointSchema, passCount: z.number().int().min(0) })),
  transitions: z.array(
    z.object({
      id: uuidSchema,
      fromStepId: uuidSchema,
      toStepId: uuidSchema,
      type: z.enum(TRANSITION_TYPES),
      label: z.string(),
      points: z.array(flowPointSchema).nullable(),
      takenCount: z.number().int().min(0),
    }),
  ),
  visits: z.array(
    z.object({
      stepId: uuidSchema,
      loop: z.number().int(),
      enteredAt: z.string(),
      exitedAt: z.string().nullable(),
      dueAt: z.string().nullable(),
      result: z.enum(['ON_TIME', 'LATE']).nullable(),
    }),
  ),
}) satisfies z.ZodType<TicketFlowResponse>;

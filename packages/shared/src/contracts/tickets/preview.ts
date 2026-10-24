import { z } from 'zod';
import { uuidSchema } from '../ids.js';
import { createTicketRequestSchema } from './schemas.js';
import { STEP_TYPES, type StepType } from '../../workflow/constants.js';

/**
 * What a decision would do, asked before answering the step: the values the person has typed so far (the conditions
 * on the way read them; invalid or missing ones are left out, nothing is checked or saved) and the visit they see.
 */
export const transitionPreviewRequestSchema = z.object({
  transitionId: uuidSchema,
  visitId: uuidSchema,
  values: z.record(z.string(), z.unknown()).default({}),
});
export type TransitionPreviewRequest = z.infer<typeof transitionPreviewRequestSchema>;

/** The same preview before creating a ticket: what the creation form says so far, without its title, description and files. */
export const creationPreviewRequestSchema = createTicketRequestSchema.pick({ subcategoryId: true, startStepId: true, companyId: true, requesterId: true, values: true });
export type CreationPreviewRequest = z.infer<typeof creationPreviewRequestSchema>;

/**
 * Who gets the next step: one `PERSON`; a `POOL` where the first to act takes it; `PARALLEL` signers who each sign;
 * `DISPATCH`, handed out in turns by the system among `people`; or `CHOOSE`, where the person answering must pick one
 * of `people` (send it as `assigneeId`).
 */
export const NEXT_ASSIGNMENTS = ['PERSON', 'POOL', 'PARALLEL', 'DISPATCH', 'CHOOSE'] as const;
export type NextAssignment = (typeof NEXT_ASSIGNMENTS)[number];

/**
 * Where a decision takes the ticket: to a people `STEP`, to a `WAIT` until `resumeAt`, to the `END`, or nowhere
 * because the workflow cannot go on (`BLOCKED`, with the error the answer would get: nobody to assign, no branch
 * that matches, the step visited too many times...). `via` are the automatic blocks passed on the way.
 */
export interface TransitionPreviewResponse {
  readonly outcome: 'STEP' | 'WAIT' | 'END' | 'BLOCKED';
  readonly via: ReadonlyArray<{ readonly name: string; readonly blockType: string }>;
  readonly step: { readonly id: string; readonly name: string; readonly type: StepType } | null;
  readonly assignment: NextAssignment | null;
  readonly people: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** Labels of the fields filled on the next step. */
  readonly fields: readonly string[];
  readonly resumeAt: string | null;
  readonly blocked: { readonly code: string; readonly details: unknown } | null;
}

/** Parses `TransitionPreviewResponse` (for the web client). */
export const transitionPreviewResponseSchema = z.object({
  outcome: z.enum(['STEP', 'WAIT', 'END', 'BLOCKED']),
  via: z.array(z.object({ name: z.string(), blockType: z.string() })),
  step: z.object({ id: uuidSchema, name: z.string(), type: z.enum(STEP_TYPES) }).nullable(),
  assignment: z.enum(NEXT_ASSIGNMENTS).nullable(),
  people: z.array(z.object({ id: uuidSchema, name: z.string() })),
  fields: z.array(z.string()),
  resumeAt: z.string().nullable(),
  blocked: z.object({ code: z.string(), details: z.unknown() }).nullable(),
}) satisfies z.ZodType<TransitionPreviewResponse>;

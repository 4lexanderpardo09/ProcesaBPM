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
 * A signer of the next PARALLEL step that resolved to nobody: as in the help desk, the person answering picks who signs
 * in its place among `candidates` (the company's members) or leaves that signature out. `label` is the signer's own
 * label, else the position's name; `null` when it has neither.
 */
export interface SignerChoice {
  readonly signerId: string;
  readonly signerType: 'USER' | 'POSITION' | 'APPROVER' | 'CREATOR';
  readonly label: string | null;
  readonly candidates: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

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
  /** The signers to choose for (send the answers as `signerChoices`); empty when every signer resolved. */
  readonly signerChoices: readonly SignerChoice[];
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
  signerChoices: z
    .array(
      z.object({
        signerId: uuidSchema,
        signerType: z.enum(['USER', 'POSITION', 'APPROVER', 'CREATOR']),
        label: z.string().nullable(),
        candidates: z.array(z.object({ id: uuidSchema, name: z.string() })),
      }),
    )
    .default([]),
}) satisfies z.ZodType<TransitionPreviewResponse>;

/** What signing one's own pending signature of a PARALLEL step would do, asked before signing (`visitId`: the visit seen). */
export const parallelSignPreviewRequestSchema = z.object({ visitId: uuidSchema });
export type ParallelSignPreviewRequest = z.infer<typeof parallelSignPreviewRequestSchema>;

/**
 * `last`: whether this is the signature the step still waits for last. Only then does the step move on, and `next`
 * says where to, as a decision's preview does (with the signers of a next PARALLEL step to choose for).
 */
export interface ParallelSignPreviewResponse {
  readonly last: boolean;
  readonly next: TransitionPreviewResponse | null;
}

export const parallelSignPreviewResponseSchema = z.object({
  last: z.boolean(),
  next: transitionPreviewResponseSchema.nullable(),
}) satisfies z.ZodType<ParallelSignPreviewResponse>;

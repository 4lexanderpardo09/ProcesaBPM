import { z } from 'zod';
import { CLOSE_RULES, type CloseRule, FIELD_TYPES, type FieldType, STEP_TYPES, type StepType } from '../../workflow/constants.js';
import { uuidSchema } from '../ids.js';

/**
 * The forms a member fills: what the web app needs to draw them. The same rules decide what is shown and what the
 * engine accepts, so a form never offers what the submission would then refuse.
 */

/** A field of the workflow version, as the form draws it. */
export interface FormFieldResponse {
  readonly id: string;
  readonly stepId: string;
  readonly code: string;
  readonly label: string;
  readonly type: FieldType;
  readonly isRequired: boolean;
  readonly isReadOnly: boolean;
  readonly sortOrder: number;
  readonly config: Readonly<Record<string, unknown>>;
  /** Where the values come from (preset list, dataset or calculator); `null` for a free field. */
  readonly dataSource: Readonly<Record<string, unknown>> | null;
}

/** `requesterId`: the form for the person a ticket is created for (needs `create_for_others`); the caller's by default. */
export const creationFormQuerySchema = z.object({ companyId: uuidSchema.optional(), requesterId: uuidSchema.optional() });
export type CreationFormQuery = z.infer<typeof creationFormQuerySchema>;

export interface CreationFormStart {
  readonly stepId: string;
  readonly name: string;
  readonly description: string | null;
  /** The fields captured when creating from this start, in order. */
  readonly fields: readonly FormFieldResponse[];
}

/** Creating a ticket of a subcategory for oneself: only the START blocks that admit the caller are listed. */
export interface CreationFormResponse {
  readonly subcategoryId: string;
  readonly workflowId: string;
  readonly versionId: string;
  readonly companyId: string;
  /** The organization's default priority, preselected as the requester's (the workflow's own is shown apart). */
  readonly defaultPriorityId: string | null;
  readonly starts: readonly CreationFormStart[];
}

/** `GET /workflows/:id/creation-check`: may this person open a ticket of the workflow for this company? */
export const creationCheckQuerySchema = z.object({ userId: uuidSchema, companyId: uuidSchema });
export type CreationCheckQuery = z.infer<typeof creationCheckQuerySchema>;

export type InitiatorKind = 'USER' | 'POSITION' | 'GROUP' | 'DEPARTMENT' | 'COMPANY' | 'SITE';

/**
 * Why a person may or may not open a ticket of a workflow, rule by rule, as creating it would decide (the role's
 * permission to create tickets is not part of it: the role is checked on its own screen).
 */
export interface CreationCheckResponse {
  readonly canCreate: boolean;
  /** An active member of the organization. */
  readonly activeMember: boolean;
  /** The company is active and one of the person's. */
  readonly companyAllowed: boolean;
  /** The subcategory and its category are active and shown to that company and the person's department. */
  readonly subcategoryVisible: boolean;
  /** The workflow is active and has a published version the engine can run. */
  readonly published: boolean;
  /** Each START block: open to everyone (no initiators), or each rule and whether the person meets it. */
  readonly starts: ReadonlyArray<{
    readonly stepId: string;
    readonly name: string;
    readonly allowed: boolean;
    readonly rules: ReadonlyArray<{ readonly kind: InitiatorKind; readonly targetId: string; readonly matches: boolean }>;
  }>;
}

const initiatorKindSchema = z.enum(['USER', 'POSITION', 'GROUP', 'DEPARTMENT', 'COMPANY', 'SITE']);

export const creationCheckResponseSchema = z.object({
  canCreate: z.boolean(),
  activeMember: z.boolean(),
  companyAllowed: z.boolean(),
  subcategoryVisible: z.boolean(),
  published: z.boolean(),
  starts: z.array(z.object({ stepId: z.string(), name: z.string(), allowed: z.boolean(), rules: z.array(z.object({ kind: initiatorKindSchema, targetId: z.string(), matches: z.boolean() })) })),
}) satisfies z.ZodType<CreationCheckResponse>;

/** A decision the people on the step can take: the `transitionId` of `POST /tickets/:id/transition`. */
export interface FormDecisionResponse {
  readonly transitionId: string;
  readonly label: string;
  /** Taking it needs a comment saying why (a rejection, a return to correct). */
  readonly requiresComment: boolean;
}

/**
 * The current step of a ticket: every field of its version (to show the values), which of them are filled on this
 * step, and the decisions that move it on. `step` is `null` once the ticket is closed.
 */
export interface TicketFormResponse {
  readonly ticketId: string;
  readonly versionId: string;
  readonly visitId: string | null;
  readonly step: { readonly id: string; readonly name: string; readonly type: StepType; readonly description: string | null; readonly closeRule: CloseRule } | null;
  readonly fields: readonly FormFieldResponse[];
  /** Codes of the fields captured on the current step (empty when closed). */
  readonly editableFieldCodes: readonly string[];
  readonly decisions: readonly FormDecisionResponse[];
}

/** Parses `FormFieldResponse` (for the web client); `satisfies` keeps it in step with the interface. */
export const formFieldResponseSchema = z.object({
  id: uuidSchema,
  stepId: uuidSchema,
  code: z.string(),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  isRequired: z.boolean(),
  isReadOnly: z.boolean(),
  sortOrder: z.number(),
  config: z.record(z.string(), z.unknown()),
  dataSource: z.record(z.string(), z.unknown()).nullable(),
}) satisfies z.ZodType<FormFieldResponse>;

/** Parses `CreationFormResponse` (for the web client). */
export const creationFormResponseSchema = z.object({
  subcategoryId: uuidSchema,
  workflowId: uuidSchema,
  versionId: uuidSchema,
  companyId: uuidSchema,
  defaultPriorityId: uuidSchema.nullable(),
  starts: z.array(z.object({ stepId: uuidSchema, name: z.string(), description: z.string().nullable(), fields: z.array(formFieldResponseSchema) })),
}) satisfies z.ZodType<CreationFormResponse>;

/** Parses `TicketFormResponse` (for the web client). */
export const ticketFormResponseSchema = z.object({
  ticketId: uuidSchema,
  versionId: uuidSchema,
  visitId: uuidSchema.nullable(),
  step: z.object({ id: uuidSchema, name: z.string(), type: z.enum(STEP_TYPES), description: z.string().nullable(), closeRule: z.enum(CLOSE_RULES) }).nullable(),
  fields: z.array(formFieldResponseSchema),
  editableFieldCodes: z.array(z.string()),
  decisions: z.array(z.object({ transitionId: uuidSchema, label: z.string(), requiresComment: z.boolean().default(false) })),
}) satisfies z.ZodType<TicketFormResponse>;

/** `GET /fields/:fieldId/options`: the people, sites or preset entries a USER, SITE or preset list field accepts, by name. */
export const fieldOptionsQuerySchema = z.object({ q: z.string().trim().max(100).default(''), limit: z.coerce.number().int().min(1).max(50).default(20) });
export type FieldOptionsQuery = z.infer<typeof fieldOptionsQuerySchema>;

export interface FieldOptionResponse {
  /** The id the field stores. */
  readonly value: string;
  readonly label: string;
}

/** Ordered by label; at most `limit`, so a long list is narrowed with `q`. */
export interface FieldOptionsResponse {
  readonly options: readonly FieldOptionResponse[];
}

export const fieldOptionsResponseSchema = z.object({ options: z.array(z.object({ value: uuidSchema, label: z.string() })) }) satisfies z.ZodType<FieldOptionsResponse>;

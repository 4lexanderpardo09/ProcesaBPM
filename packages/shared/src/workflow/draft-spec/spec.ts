import { z } from 'zod';
import { CONDITION_OPERATORS } from '../../engine/conditions/types.js';
import { SLA_UNITS } from '../constants.js';

/**
 * The compact workflow a language model fills in («Crear con IA»). It never holds ids: blocks are named by a
 * `ref` the model invents, and positions, groups and approval types by their name in the organization's
 * catalog. `translateDraftSpec` turns it into a `WorkflowVersionDocument`.
 */
export const DRAFT_STEP_TYPES = ['START', 'TASK', 'APPROVAL', 'CONDITION', 'NOTIFICATION', 'WAIT', 'END'] as const;
export const DRAFT_ASSIGNMENT_MODES = ['POSITION', 'GROUP', 'APPROVER', 'CREATOR', 'POOL', 'SAME_AS_STEP', 'PARALLEL_APPROVALS'] as const;
export const DRAFT_SIGNER_KINDS = ['POSITION', 'APPROVER', 'CREATOR'] as const;
export const DRAFT_RECIPIENT_KINDS = ['CREATOR', 'ASSIGNEES', 'OBSERVERS', 'POSITION', 'GROUP'] as const;
export const DRAFT_FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'SELECT', 'MULTI_SELECT', 'DATE', 'DATETIME', 'DAYS', 'FILE', 'TABLE', 'FORMULA'] as const;
export const DRAFT_COLUMN_TYPES = ['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'SELECT', 'FORMULA'] as const;
export const DRAFT_FORMULA_RESULT_TYPES = ['NUMBER', 'CURRENCY', 'DATE', 'TEXT'] as const;

export const DRAFT_LIMITS = { steps: 60, transitions: 150, fields: 150, columns: 30, options: 100, text: 1000, assumptions: 20 } as const;
export const DRAFT_REF_PATTERN = /^[a-z][a-z0-9_]{0,40}$/;

const text = z.string().trim().min(1).max(DRAFT_LIMITS.text);
const nullableText = z.string().trim().max(DRAFT_LIMITS.text).nullable();
const ref = z.string();
const name = z.string().max(200);
const options = z.array(z.string().trim().min(1).max(200)).max(DRAFT_LIMITS.options).nullable();
const duration = z.object({ value: z.number().int().min(1).max(3000), unit: z.enum(SLA_UNITS) }).strict();

const signer = z.object({ kind: z.enum(DRAFT_SIGNER_KINDS), position: name.nullable() }).strict();

const assignment = z
  .object({
    mode: z.enum(DRAFT_ASSIGNMENT_MODES),
    position: name.nullable(),
    group: name.nullable(),
    approvalType: name.nullable(),
    approvalLevel: z.number().int().min(1).max(10).nullable(),
    poolPositions: z.array(name).max(50),
    poolGroups: z.array(name).max(50),
    sameAsStep: ref.nullable(),
    signers: z.array(signer).max(30),
  })
  .strict();

const recipient = z.object({ kind: z.enum(DRAFT_RECIPIENT_KINDS), name: name.nullable() }).strict();

const notification = z.object({ recipients: z.array(recipient).min(1).max(20), subject: z.string().trim().min(1).max(200), body: text }).strict();

export const draftStepSchema = z
  .object({
    ref,
    type: z.enum(DRAFT_STEP_TYPES),
    name: z.string().trim().min(1).max(200),
    instructions: nullableText,
    assignment: assignment.nullable(),
    sla: duration.nullable(),
    maxLoops: z.number().int().min(1).max(50).nullable(),
    notification: notification.nullable(),
    wait: duration.nullable(),
  })
  .strict();

const conditionValue = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.array(z.union([z.string().max(1000), z.number().finite()])).max(200)]);

export const draftTransitionSchema = z
  .object({
    from: ref,
    to: ref,
    label: z.string().trim().min(1).max(120),
    condition: z.array(z.object({ field: z.string(), op: z.enum(CONDITION_OPERATORS), value: conditionValue }).strict()).max(20).nullable(),
    requiresComment: z.boolean(),
    whenRejected: z.boolean(),
  })
  .strict();

const column = z
  .object({
    code: z.string(),
    label: z.string().trim().min(1).max(200),
    type: z.enum(DRAFT_COLUMN_TYPES),
    required: z.boolean(),
    options,
    expression: z.string().trim().max(500).nullable(),
    showTotal: z.boolean(),
  })
  .strict();

export const draftFieldSchema = z
  .object({
    step: ref,
    code: z.string(),
    label: z.string().trim().min(1).max(200),
    type: z.enum(DRAFT_FIELD_TYPES),
    required: z.boolean(),
    options,
    formula: z.object({ expression: z.string().trim().min(1).max(2000), resultType: z.enum(DRAFT_FORMULA_RESULT_TYPES) }).strict().nullable(),
    columns: z.array(column).max(DRAFT_LIMITS.columns).nullable(),
  })
  .strict();

export const workflowDraftSpecSchema = z
  .object({
    assumptions: z.array(z.string().trim().min(1).max(500)).max(DRAFT_LIMITS.assumptions),
    steps: z.array(draftStepSchema).min(1).max(DRAFT_LIMITS.steps),
    transitions: z.array(draftTransitionSchema).max(DRAFT_LIMITS.transitions),
    fields: z.array(draftFieldSchema).max(DRAFT_LIMITS.fields),
  })
  .strict();

export type WorkflowDraftSpec = z.infer<typeof workflowDraftSpecSchema>;
export type DraftStep = z.infer<typeof draftStepSchema>;
export type DraftTransition = z.infer<typeof draftTransitionSchema>;
export type DraftField = z.infer<typeof draftFieldSchema>;
export type DraftAssignment = z.infer<typeof assignment>;

/** The organization's records the model may name: only names and the ids they resolve to, nothing about people. */
export interface DraftCatalogEntry {
  readonly id: string;
  readonly name: string;
}

export interface DraftCatalog {
  readonly positions: readonly DraftCatalogEntry[];
  readonly groups: readonly DraftCatalogEntry[];
  readonly approvalTypes: readonly DraftCatalogEntry[];
}

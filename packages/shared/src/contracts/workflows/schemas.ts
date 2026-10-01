import { z } from 'zod';
import {
  AMOUNT_RULE_ACTIONS,
  ASSIGNMENT_MODES,
  CAPTURE_STAGES,
  CLOSE_RULES,
  DEADLINE_TYPES,
  FIELD_CODE_PATTERN,
  FIELD_TYPES,
  MAX_STEPS_PER_VERSION,
  MAX_TRANSITIONS_PER_VERSION,
  SITE_SCOPES,
  SLA_UNITS,
  STEP_TYPES,
  TRANSITION_TYPES,
} from '../../workflow/constants.js';
import { NEW_REF_PATTERN, type AmountRuleDocument, type FieldDocument, type StepDocument, type TransitionDocument, type WorkflowVersionDocument } from '../../workflow/document.js';
import type { WorkflowValidation } from '../../workflow/problems.js';
import { transitionConditionSchema } from '../../workflow/transition-condition.js';
import { nameSchema, pageQuerySchema } from '../common.js';
import { uuidSchema } from '../ids.js';

/** An existing row (uuid) or one drawn on the canvas and not saved yet (`new:<name>`). */
export const blockRefSchema = z.union([uuidSchema, z.string().regex(NEW_REF_PATTERN)]);
const nullableUuid = uuidSchema.nullable();
const jsonObject = z.record(z.string(), z.unknown());
const finite = z.number().finite();

// ---- Workflows ----
export const createWorkflowRequestSchema = z.object({ subcategoryId: uuidSchema, name: nameSchema });
export type CreateWorkflowRequest = z.infer<typeof createWorkflowRequestSchema>;

export const updateWorkflowRequestSchema = z
  .object({ name: nameSchema, isActive: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateWorkflowRequest = z.infer<typeof updateWorkflowRequestSchema>;

export const workflowsQuerySchema = pageQuerySchema.extend({ subcategoryId: uuidSchema.optional() });
export type WorkflowsQuery = z.infer<typeof workflowsQuerySchema>;

export const versionStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export interface VersionSummary {
  readonly id: string;
  readonly number: number;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  readonly notes: string | null;
  readonly publishedAt: string | null;
  readonly publishedById: string | null;
  readonly createdAt: string;
}
export interface WorkflowResponse {
  readonly id: string;
  readonly subcategoryId: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly createdAt: string;
}
export interface WorkflowDetailResponse extends WorkflowResponse {
  readonly versions: readonly VersionSummary[];
}

// ---- Versions ----
/** Without `fromVersionId` the draft starts empty. */
export const createVersionRequestSchema = z.object({ fromVersionId: uuidSchema.optional(), notes: z.string().trim().min(1).max(2000).optional() });
export type CreateVersionRequest = z.infer<typeof createVersionRequestSchema>;

export interface VersionDetailResponse {
  readonly workflow: { readonly id: string; readonly name: string; readonly subcategoryId: string };
  readonly version: VersionSummary;
  /** Graph, configuration and fields in one piece (the canvas maps it to React Flow nodes and edges). */
  readonly document: WorkflowVersionDocument;
  /** Only drafts are validated on read. */
  readonly validation: WorkflowValidation | null;
}

export const publishVersionRequestSchema = z.object({ notes: z.string().trim().min(1).max(2000).optional() });
export type PublishVersionRequest = z.infer<typeof publishVersionRequestSchema>;

export interface PublishVersionResponse {
  readonly version: VersionSummary;
  readonly warnings: WorkflowValidation['warnings'];
}

// ---- Save graph ----
export const stepGraphInputSchema = z
  .object({
    id: blockRefSchema,
    type: z.enum(STEP_TYPES),
    name: nameSchema,
    description: z.string().max(2000).nullable().default(null),
    assignmentMode: z.enum(ASSIGNMENT_MODES).default('NONE'),
    manualSelection: z.boolean().default(false),
    siteScope: z.enum(SITE_SCOPES).default('SAME_SITE'),
    positionId: nullableUuid.default(null),
    approvalGroupTypeId: nullableUuid.default(null),
    approvalLevel: z.number().int().min(1).max(5).nullable().default(null),
    closeRule: z.enum(CLOSE_RULES).default('NOT_ALLOWED'),
    slaValue: z.number().int().min(1).max(100_000).nullable().default(null),
    slaUnit: z.enum(SLA_UNITS).nullable().default(null),
    deadlineType: z.enum(DEADLINE_TYPES).default('SLA'),
    deadlineFieldCode: z.string().regex(FIELD_CODE_PATTERN).nullable().default(null),
    deadlineBusinessDays: z.number().int().min(1).max(365).nullable().default(null),
    maxLoops: z.number().int().min(1).max(1000).nullable().default(null),
    dispatchIntervalMin: z.number().int().min(1).max(10_080).nullable().default(null),
    allowsBatch: z.boolean().default(false),
    config: jsonObject.default({}),
    ui: z.object({ x: finite, y: finite }).default({ x: 0, y: 0 }),
  })
  .strict()
  .refine((step) => (step.slaValue === null) === (step.slaUnit === null), { message: 'slaValue and slaUnit go together', path: ['slaUnit'] });
export type StepGraphInput = z.infer<typeof stepGraphInputSchema>;

export const transitionGraphInputSchema = z
  .object({
    id: blockRefSchema,
    fromStepId: blockRefSchema,
    toStepId: blockRefSchema,
    type: z.enum(TRANSITION_TYPES),
    label: nameSchema,
    condition: transitionConditionSchema.nullable().default(null),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
    uiPoints: z.array(z.object({ x: finite, y: finite }).strict()).max(50).nullable().default(null),
  })
  .strict();
export type TransitionGraphInput = z.infer<typeof transitionGraphInputSchema>;

/** The whole canvas: the blocks and transitions replace the ones of the draft in one transaction. */
export const saveGraphRequestSchema = z
  .object({
    steps: z.array(stepGraphInputSchema).max(MAX_STEPS_PER_VERSION),
    transitions: z.array(transitionGraphInputSchema).max(MAX_TRANSITIONS_PER_VERSION),
  })
  .strict()
  .superRefine((graph, context) => {
    const stepIds = graph.steps.map((step) => step.id);
    if (new Set(stepIds).size !== stepIds.length) context.addIssue({ code: 'custom', message: 'Repeated block ids', path: ['steps'] });
    const transitionIds = graph.transitions.map((transition) => transition.id);
    if (new Set(transitionIds).size !== transitionIds.length) context.addIssue({ code: 'custom', message: 'Repeated transition ids', path: ['transitions'] });
  });
export type SaveGraphRequest = z.infer<typeof saveGraphRequestSchema>;

export interface SaveGraphResponse {
  /** The id given to each `new:` reference. */
  readonly idMap: Readonly<Record<string, string>>;
  readonly document: WorkflowVersionDocument;
  readonly validation: WorkflowValidation;
}

// ---- Fields ----
export const createFieldRequestSchema = z
  .object({
    stepId: uuidSchema,
    code: z.string().regex(FIELD_CODE_PATTERN),
    label: nameSchema,
    type: z.enum(FIELD_TYPES),
    capture: z.enum(CAPTURE_STAGES).default('BOTH'),
    isRequired: z.boolean().default(false),
    isReadOnly: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
    config: jsonObject.default({}),
    dataSource: jsonObject.nullable().default(null),
  })
  .strict();
export type CreateFieldRequest = z.infer<typeof createFieldRequestSchema>;

/** The code and type of a field never change (conditions, PDFs and amount rules refer to them). */
export const updateFieldRequestSchema = z
  .object({
    stepId: uuidSchema,
    label: nameSchema,
    capture: z.enum(CAPTURE_STAGES),
    isRequired: z.boolean(),
    isReadOnly: z.boolean(),
    sortOrder: z.number().int().min(0).max(100_000),
    config: jsonObject,
    dataSource: jsonObject.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateFieldRequest = z.infer<typeof updateFieldRequestSchema>;

// ---- Amount rules ----
const decimalString = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'Use a decimal number with up to two decimals').refine((value) => Number(value) > 0, 'Must be positive');

export const createAmountRuleRequestSchema = z
  .object({
    stepId: nullableUuid.default(null),
    positionId: nullableUuid.default(null),
    companyId: nullableUuid.default(null),
    fieldCode: z.string().regex(FIELD_CODE_PATTERN),
    rowTypeValue: z.string().min(1).max(200).nullable().default(null),
    amountColumn: z.string().min(1).max(100).nullable().default(null),
    typeColumn: z.string().min(1).max(100).nullable().default(null),
    maxAmount: decimalString,
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    action: z.enum(AMOUNT_RULE_ACTIONS),
    approvalStepId: nullableUuid.default(null),
    message: z.string().max(500).nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .strict();
export type CreateAmountRuleRequest = z.infer<typeof createAmountRuleRequestSchema>;

export const updateAmountRuleRequestSchema = z
  .object({
    stepId: nullableUuid,
    positionId: nullableUuid,
    companyId: nullableUuid,
    fieldCode: z.string().regex(FIELD_CODE_PATTERN),
    rowTypeValue: z.string().min(1).max(200).nullable(),
    amountColumn: z.string().min(1).max(100).nullable(),
    typeColumn: z.string().min(1).max(100).nullable(),
    maxAmount: decimalString,
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    action: z.enum(AMOUNT_RULE_ACTIONS),
    approvalStepId: nullableUuid,
    message: z.string().max(500).nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateAmountRuleRequest = z.infer<typeof updateAmountRuleRequestSchema>;

// ---- Step children (each list replaces the previous one) ----
const candidateSchema = z.discriminatedUnion('participantType', [
  z.object({ participantType: z.literal('USER'), userId: uuidSchema }).strict(),
  z.object({ participantType: z.literal('POSITION'), positionId: uuidSchema }).strict(),
  z.object({ participantType: z.literal('GROUP'), groupId: uuidSchema }).strict(),
]);
export const replaceCandidatesRequestSchema = z.object({ candidates: z.array(candidateSchema).max(500) }).strict();
export type ReplaceCandidatesRequest = z.infer<typeof replaceCandidatesRequestSchema>;

const initiatorSchema = z.discriminatedUnion('participantType', [
  z.object({ participantType: z.literal('USER'), userId: uuidSchema }).strict(),
  z.object({ participantType: z.literal('POSITION'), positionId: uuidSchema }).strict(),
  z.object({ participantType: z.literal('GROUP'), groupId: uuidSchema }).strict(),
  z.object({ participantType: z.literal('DEPARTMENT'), departmentId: uuidSchema }).strict(),
  z.object({ participantType: z.literal('COMPANY'), companyId: uuidSchema }).strict(),
  z.object({ participantType: z.literal('SITE'), siteId: uuidSchema }).strict(),
]);
/** No initiators = anyone in the tenant may start a ticket. */
export const replaceInitiatorsRequestSchema = z.object({ initiators: z.array(initiatorSchema).max(500) }).strict();
export type ReplaceInitiatorsRequest = z.infer<typeof replaceInitiatorsRequestSchema>;

const signerLabel = z.string().max(200).nullable().default(null);
const signerSchema = z.discriminatedUnion('signerType', [
  z.object({ signerType: z.literal('USER'), userId: uuidSchema, label: signerLabel }).strict(),
  z.object({ signerType: z.literal('POSITION'), positionId: uuidSchema, label: signerLabel }).strict(),
  z.object({ signerType: z.literal('APPROVER'), label: signerLabel }).strict(),
  z.object({ signerType: z.literal('CREATOR'), label: signerLabel }).strict(),
  z.object({ signerType: z.literal('STEP_ASSIGNEE'), label: signerLabel }).strict(),
]);
export const replaceSignersRequestSchema = z.object({ signers: z.array(signerSchema).max(50) }).strict();
export type ReplaceSignersRequest = z.infer<typeof replaceSignersRequestSchema>;

export const replaceSlaOverridesRequestSchema = z
  .object({
    overrides: z
      .array(z.object({ companyId: uuidSchema, slaValue: z.number().int().min(1).max(100_000), slaUnit: z.enum(SLA_UNITS) }).strict())
      .max(200)
      .refine((list) => new Set(list.map((entry) => entry.companyId)).size === list.length, 'One override per company'),
  })
  .strict();
export type ReplaceSlaOverridesRequest = z.infer<typeof replaceSlaOverridesRequestSchema>;

export const replaceStepFilesRequestSchema = z
  .object({
    files: z
      .array(z.object({ fileId: uuidSchema, label: nameSchema, sortOrder: z.number().int().min(0).max(1000).default(0) }).strict())
      .max(50)
      .refine((list) => new Set(list.map((entry) => entry.fileId)).size === list.length, 'Repeated files'),
  })
  .strict();
export type ReplaceStepFilesRequest = z.infer<typeof replaceStepFilesRequestSchema>;

// ---- Observers and company cutoffs ----
export const addObserverRequestSchema = z.discriminatedUnion('participantType', [
  z.object({ participantType: z.literal('USER'), userId: uuidSchema }).strict(),
  z.object({ participantType: z.literal('POSITION'), positionId: uuidSchema }).strict(),
  z.object({ participantType: z.literal('GROUP'), groupId: uuidSchema }).strict(),
]);
export type AddObserverRequest = z.infer<typeof addObserverRequestSchema>;

export interface ObserverResponse {
  readonly id: string;
  readonly participantType: 'USER' | 'POSITION' | 'GROUP';
  readonly userId: string | null;
  readonly positionId: string | null;
  readonly groupId: string | null;
}

export const createCutoffRequestSchema = z
  .object({
    companyId: uuidSchema,
    cutoffDay: z.number().int().min(1).max(31),
    graceBusinessDays: z.number().int().min(0).max(30).default(0),
    description: z.string().trim().min(1).max(500).nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .strict();
export type CreateCutoffRequest = z.infer<typeof createCutoffRequestSchema>;

export const updateCutoffRequestSchema = z
  .object({ cutoffDay: z.number().int().min(1).max(31), graceBusinessDays: z.number().int().min(0).max(30), description: z.string().trim().min(1).max(500).nullable(), isActive: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateCutoffRequest = z.infer<typeof updateCutoffRequestSchema>;

export interface CutoffResponse {
  readonly id: string;
  readonly companyId: string;
  readonly cutoffDay: number;
  readonly graceBusinessDays: number;
  readonly description: string | null;
  readonly isActive: boolean;
}

export type { AmountRuleDocument, FieldDocument, StepDocument, TransitionDocument };

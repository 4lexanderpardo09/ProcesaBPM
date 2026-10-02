import { z } from 'zod';
import { FIELD_CODE_PATTERN, SLA_UNITS, type StepType } from './constants.js';

const instructions = z.string().max(5000).optional();
const uuid = z.uuid();
const fieldCode = z.string().regex(FIELD_CODE_PATTERN);
const batch = z.object({ maxTickets: z.number().int().min(1).max(500) }).strict().optional();

const recipient = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['CREATOR', 'ASSIGNEES', 'OBSERVERS']) }).strict(),
  z.object({ kind: z.enum(['USER', 'POSITION', 'GROUP']), id: uuid }).strict(),
]);

const wait = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('DURATION'), value: z.number().int().min(1).max(3000), unit: z.enum(SLA_UNITS) }).strict(),
  z.object({ mode: z.literal('UNTIL_FIELD_DATE'), fieldCode, offsetBusinessDays: z.number().int().min(-365).max(365) }).strict(),
  z.object({ mode: z.literal('COMPANY_CUTOFF') }).strict(),
]);

/**
 * `config` of each block type. What the engine queries lives in typed columns of `steps`; this holds the
 * rest. Strict: an unknown key is an error. It never holds step, field or transition ids (a version copy is
 * a plain copy of this JSON): only field codes and ids of workflow- or tenant-level records.
 */
export const BLOCK_CONFIG_SCHEMAS: Readonly<Record<StepType, z.ZodType<Record<string, unknown>>>> = {
  START: z.object({}).strict(),
  TASK: z.object({ instructions, batch }).strict(),
  APPROVAL: z.object({ instructions, batch, rejectRequiresComment: z.boolean().default(true) }).strict(),
  DECISION: z.object({ instructions }).strict(),
  SIGNATURE: z.object({ instructions, document: z.enum(['MAIN_DOCUMENT', 'STEP_DOCUMENT']) }).strict(),
  CONDITION: z.object({}).strict(),
  DOCUMENT: z.object({ workflowDocumentId: uuid, role: z.enum(['MAIN_DOCUMENT', 'STEP_DOCUMENT']) }).strict(),
  EXPORT: z.object({ exportDefinitionId: uuid }).strict(),
  NOTIFICATION: z
    .object({
      recipients: z.array(recipient).min(1).max(20),
      channels: z.array(z.enum(['EMAIL', 'IN_APP'])).min(1),
      subject: z.string().max(200),
      body: z.string().max(10_000),
    })
    .strict(),
  WEBHOOK: z
    .object({ webhookId: uuid, bodyTemplate: z.string().max(20_000).optional(), timeoutMs: z.number().int().min(1000).max(30_000).default(10_000), maxRetries: z.number().int().min(0).max(5).default(3) })
    .strict(),
  CALCULATOR: z.object({ calculatorCode: z.string().min(1).max(100), inputs: z.record(z.string().min(1).max(100), fieldCode), outputFieldCode: fieldCode }).strict(),
  WAIT: wait,
  END: z.object({}).strict(),
};

export type BlockConfigResult = { readonly valid: true; readonly config: Record<string, unknown> } | { readonly valid: false; readonly issues: readonly string[] };

/** Parses (and normalizes: defaults applied) the config of a block. */
export function parseBlockConfig(type: StepType, config: unknown): BlockConfigResult {
  const result = BLOCK_CONFIG_SCHEMAS[type].safeParse(config ?? {});
  return result.success ? { valid: true, config: result.data } : { valid: false, issues: result.error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`) };
}

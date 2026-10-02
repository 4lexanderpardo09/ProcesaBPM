import { z } from 'zod';
import { FIELD_CODE_PATTERN, type FieldType } from './constants.js';

const uuid = z.uuid();
const code = z.string().regex(FIELD_CODE_PATTERN);
const currency = z.string().regex(/^[A-Z]{3}$/);
const dateBound = z.union([z.literal('TODAY'), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const option = z.object({ value: z.string().min(1).max(200), label: z.string().min(1).max(200) }).strict();
const options = z
  .array(option)
  .max(500)
  .refine((list) => new Set(list.map((entry) => entry.value)).size === list.length, 'Option values must be unique');

const tableColumn = z
  .object({ code, label: z.string().min(1).max(200), type: z.enum(['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'SELECT']), required: z.boolean().default(false), options: options.optional() })
  .strict();

/** `config` of a field by type. No user-supplied regex (ReDoS), no ids of this version. */
export const FIELD_CONFIG_SCHEMAS: Readonly<Record<FieldType, z.ZodType<Record<string, unknown>>>> = {
  TEXT: z.object({ maxLength: z.number().int().min(1).max(1000).optional(), placeholder: z.string().max(200).optional() }).strict(),
  TEXTAREA: z.object({ maxLength: z.number().int().min(1).max(10_000).optional() }).strict(),
  NUMBER: z.object({ min: z.number().optional(), max: z.number().optional(), decimals: z.number().int().min(0).max(6).default(0) }).strict(),
  CURRENCY: z.object({ currencyCode: currency.optional(), min: z.number().optional(), max: z.number().optional() }).strict(),
  SELECT: z.object({ options: options.optional() }).strict(),
  MULTI_SELECT: z.object({ options: options.optional(), minSelected: z.number().int().min(0).optional(), maxSelected: z.number().int().min(1).optional() }).strict(),
  DATE: z.object({ min: dateBound.optional(), max: dateBound.optional() }).strict(),
  DATETIME: z.object({ min: dateBound.optional(), max: dateBound.optional() }).strict(),
  DAYS: z.object({ min: z.number().int().optional(), max: z.number().int().optional() }).strict(),
  SITE: z.object({ level: z.number().int().min(1).max(20).optional() }).strict(),
  USER: z.object({ positionIds: z.array(uuid).max(100).optional() }).strict(),
  TABLE: z
    .object({
      columns: z
        .array(tableColumn)
        .min(1)
        .max(30)
        .refine((columns) => new Set(columns.map((column) => column.code)).size === columns.length, 'Column codes must be unique'),
      minRows: z.number().int().min(0).default(0),
      maxRows: z.number().int().min(1).max(200).default(200),
    })
    .strict(),
  FILE: z.object({ maxFiles: z.number().int().min(1).max(15).default(1), accept: z.array(z.enum(['PDF', 'IMAGE', 'OFFICE', 'ZIP'])).min(1).default(['PDF', 'IMAGE', 'OFFICE', 'ZIP']) }).strict(),
  FORMULA: z.object({ expression: z.string().min(1).max(2000), resultType: z.enum(['NUMBER', 'CURRENCY', 'DATE', 'TEXT']), decimals: z.number().int().min(0).max(6).optional() }).strict(),
  CALCULATOR: z.object({ calculatorCode: z.string().min(1).max(100) }).strict(),
};

/** Where a field takes its values from (a preset list, an uploaded dataset or a calculator). */
export const fieldDataSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PRESET'), preset: z.enum(['COMPANIES', 'DEPARTMENTS', 'POSITIONS', 'SITES', 'USERS']) }).strict(),
  z.object({ kind: z.literal('DATASET'), datasetId: uuid, column: z.string().min(1).max(200), lookupFieldCode: code.optional() }).strict(),
  z.object({ kind: z.literal('CALCULATOR'), calculatorCode: z.string().min(1).max(100) }).strict(),
]);
export type FieldDataSource = z.infer<typeof fieldDataSourceSchema>;

const DATA_SOURCE_FIELD_TYPES: Readonly<Record<FieldDataSource['kind'], ReadonlySet<string>>> = {
  PRESET: new Set(['SELECT', 'MULTI_SELECT']),
  DATASET: new Set(['SELECT', 'MULTI_SELECT', 'TEXT']),
  CALCULATOR: new Set(['CALCULATOR']),
};

export type FieldConfigResult = { readonly valid: true; readonly config: Record<string, unknown> } | { readonly valid: false; readonly issues: readonly string[] };

export function parseFieldConfig(type: FieldType, config: unknown, dataSource: unknown): FieldConfigResult {
  const parsed = FIELD_CONFIG_SCHEMAS[type].safeParse(config ?? {});
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`) };
  const hasOptions = Array.isArray((parsed.data as { options?: unknown }).options) && ((parsed.data as { options: unknown[] }).options.length > 0);
  if ((type === 'SELECT' || type === 'MULTI_SELECT') && !hasOptions && (dataSource === null || dataSource === undefined)) {
    return { valid: false, issues: ['config.options: a list needs options or a data source'] };
  }
  return { valid: true, config: parsed.data };
}

export type DataSourceResult = { readonly valid: true } | { readonly valid: false; readonly issues: readonly string[] };

export function checkFieldDataSource(type: FieldType, dataSource: unknown): DataSourceResult {
  if (dataSource === null || dataSource === undefined) return { valid: true };
  const parsed = fieldDataSourceSchema.safeParse(dataSource);
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map((issue) => `dataSource.${issue.path.join('.')}: ${issue.message}`) };
  return DATA_SOURCE_FIELD_TYPES[parsed.data.kind].has(type) ? { valid: true } : { valid: false, issues: [`dataSource: ${parsed.data.kind} does not apply to ${type} fields`] };
}

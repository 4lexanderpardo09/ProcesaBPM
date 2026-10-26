import { z } from 'zod';
import { uuidSchema } from '../ids.js';

/** Where a column takes its value from. `sourceRef` says which one; see `exportColumnSchema`. */
export const EXPORT_COLUMN_SOURCES = ['FIELD', 'DERIVED', 'CONSTANT', 'COMPANY', 'REQUESTER', 'TABLE_SUM', 'CATALOG', 'SEQUENCE', 'CUTOFF_DATE', 'TICKET_DATE', 'FORMULA'] as const;
export type ExportColumnSource = (typeof EXPORT_COLUMN_SOURCES)[number];
export const EXPORT_VALUE_FORMATS = ['TRIM', 'UPPER', 'INTEGER', 'INTEGER_OR_EMPTY', 'DECIMAL_2', 'DATE_DMY'] as const;
export type ExportValueFormat = (typeof EXPORT_VALUE_FORMATS)[number];
/** What a REQUESTER column reads of the person the ticket is for. */
export const EXPORT_REQUESTER_ATTRIBUTES = ['FIRST_NAME', 'LAST_NAME', 'FULL_NAME', 'EMAIL', 'DOCUMENT_NUMBER'] as const;
export const EXPORT_FILTER_OPERATORS = ['EQUALS', 'NOT_EQUALS', 'STARTS_WITH', 'CONTAINS', 'IN_LIST'] as const;
export const EXPORT_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'EVERY_N_DAYS'] as const;
/** The separators a CSV file may use; `\t` is a tab. */
export const EXPORT_DELIMITERS = [';', ',', '|', '\t'] as const;

const header = z.string().trim().min(1).max(100);

/** One part of a TABLE_SUM reference: a column of a table, only the rows whose `filter.column` is one of `filter.values`; or a whole number field. */
export interface TableSumPart {
  readonly field: string;
  readonly column: string | null;
  readonly filter: { readonly column: string; readonly values: readonly string[] } | null;
}

/**
 * Reads a TABLE_SUM reference, the help desk's own syntax: parts separated by `;`, each `TABLE:COLUMN`, optionally
 * `:KEY=a|b` to add only the rows whose KEY is one of those values, or just `FIELD` to add a number field. So
 * `ALIMENTACION;CONCEPTOS:SUBTOTAL:TIPO=Alimentación` is the meals the calculator gave plus the meals asked as concepts.
 * Null when a part is malformed.
 */
export function parseTableSumReference(reference: string): readonly TableSumPart[] | null {
  const parts = reference.split(';').map((part) => part.trim());
  if (parts.length === 0 || parts.length > 20) return null;
  const parsed: TableSumPart[] = [];
  for (const part of parts) {
    const [field, column, filter, ...rest] = part.split(':').map((piece) => piece.trim());
    if (field === undefined || !FIELD_CODE.test(field) || rest.length > 0) return null;
    if (column === undefined) {
      parsed.push({ field, column: null, filter: null });
      continue;
    }
    if (column === '') return null;
    if (filter === undefined) {
      parsed.push({ field, column, filter: null });
      continue;
    }
    const [key, list] = filter.split('=');
    const values = (list ?? '').split('|').map((value) => value.trim()).filter((value) => value !== '');
    if (key === undefined || key.trim() === '' || values.length === 0) return null;
    parsed.push({ field, column, filter: { column: key.trim(), values } });
  }
  return parsed;
}
const CATALOG_NAME = /^[A-Za-z0-9_-]{1,50}$/;
const FIELD_CODE = /^[A-Z][A-Z0-9_]*$/;

/**
 * One column of the file. `sourceRef` by source: FIELD and DERIVED a field code; CONSTANT the text; REQUESTER one of
 * `EXPORT_REQUESTER_ATTRIBUTES`; TABLE_SUM `TABLE:COLUMN[:KEY=a|b]` or a number field, several joined by `;` (`parseTableSumReference`); CATALOG `catalog:FIELD` (the field's value translated by the
 * catalog, or kept when it has no entry); FORMULA a formula over the ticket's fields. COMPANY, SEQUENCE (the row number
 * in the file), CUTOFF_DATE and TICKET_DATE take none.
 */
export const exportColumnSchema = z
  .object({ header, sourceType: z.enum(EXPORT_COLUMN_SOURCES), sourceRef: z.string().trim().max(2000).nullable().default(null), format: z.enum(EXPORT_VALUE_FORMATS).nullable().default(null) })
  .strict()
  .superRefine((column, context) => {
    const ref = column.sourceRef ?? '';
    const fail = (message: string) => context.addIssue({ code: 'custom', path: ['sourceRef'], message });
    switch (column.sourceType) {
      case 'FIELD':
      case 'DERIVED':
        if (!FIELD_CODE.test(ref)) fail('A field code is needed');
        break;
      case 'REQUESTER':
        if (!(EXPORT_REQUESTER_ATTRIBUTES as readonly string[]).includes(ref)) fail('A requester attribute is needed');
        break;
      case 'TABLE_SUM':
        if (parseTableSumReference(ref) === null) fail('TABLE:COLUMN[:KEY=a|b] or FIELD, several separated by ; is needed');
        break;
      case 'CATALOG': {
        const [catalog, field] = ref.split(':');
        if (catalog === undefined || field === undefined || !CATALOG_NAME.test(catalog) || !FIELD_CODE.test(field)) fail('catalog:FIELD is needed');
        break;
      }
      case 'FORMULA':
        if (ref === '') fail('A formula is needed');
        break;
      default:
        break;
    }
  });
export type ExportColumn = z.infer<typeof exportColumnSchema>;

/** A rule of the filter: a line is only kept when every rule holds (case and outer spaces ignored). */
export const exportFilterRuleSchema = z.object({ fieldCode: z.string().regex(FIELD_CODE), operator: z.enum(EXPORT_FILTER_OPERATORS), value: z.string().max(500) }).strict();
export type ExportFilterRule = z.infer<typeof exportFilterRuleSchema>;

/** One file per person holding a step (each reviewer gets their own), or per value of a column of the file. */
export const exportSeparationSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('RESPONSIBLE'), stepId: uuidSchema }).strict(), z.object({ kind: z.literal('COLUMN'), header }).strict()]);
export type ExportSeparation = z.infer<typeof exportSeparationSchema>;

/** When the scheduled cutoff runs, in the company's time zone. Weekdays: 1 = Monday … 7 = Sunday. */
export const exportScheduleSchema = z
  .object({
    cutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    frequency: z.enum(EXPORT_FREQUENCIES),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    monthDay: z.number().int().min(1).max(31).nullable().default(null),
    intervalDays: z.number().int().min(1).max(365).nullable().default(null),
  })
  .strict()
  .refine((schedule) => schedule.frequency !== 'WEEKLY' || schedule.weekdays.length > 0, { message: 'A weekly cutoff needs its days', path: ['weekdays'] })
  .refine((schedule) => schedule.frequency !== 'MONTHLY' || schedule.monthDay !== null, { message: 'A monthly cutoff needs its day', path: ['monthDay'] })
  .refine((schedule) => schedule.frequency !== 'EVERY_N_DAYS' || schedule.intervalDays !== null, { message: 'Say every how many days', path: ['intervalDays'] });
export type ExportSchedule = z.infer<typeof exportScheduleSchema>;

/**
 * `POST /exports` and `PUT /exports/:id`: the whole definition with its columns. A line is written when a ticket of the
 * workflow takes the transition named `transitionLabel` (or closes, with `CLOSING`) and passes the filter; the scheduled
 * cutoff gathers the pending lines into files. `mergeBy` joins the rows with the same value in that column (amounts
 * add up); `companyId` limits it to the tickets of one company.
 */
export const saveExportDefinitionRequestSchema = z
  .object({
    workflowId: uuidSchema,
    companyId: uuidSchema.nullable().default(null),
    name: z.string().trim().min(1).max(150),
    format: z.enum(['CSV', 'XLSX']),
    sheetName: z.string().trim().min(1).max(31).default('Export'),
    delimiter: z.enum(EXPORT_DELIMITERS).default(';'),
    trigger: z.enum(['TRANSITION', 'CLOSING']),
    transitionLabel: z.string().trim().min(1).max(100).nullable().default(null),
    filter: z.array(exportFilterRuleSchema).max(20).default([]),
    mergeBy: header.nullable().default(null),
    separateBy: exportSeparationSchema.nullable().default(null),
    schedule: exportScheduleSchema,
    isActive: z.boolean().default(true),
    columns: z.array(exportColumnSchema).min(1).max(100),
  })
  .strict()
  .refine((definition) => definition.trigger !== 'TRANSITION' || definition.transitionLabel !== null, { message: 'Say which transition writes the line', path: ['transitionLabel'] })
  .refine((definition) => new Set(definition.columns.map((column) => column.header.toLowerCase())).size === definition.columns.length, { message: 'Column headers must be unique', path: ['columns'] })
  .refine((definition) => definition.mergeBy === null || definition.columns.some((column) => column.header === definition.mergeBy), { message: 'Merge by one of the columns', path: ['mergeBy'] })
  .refine((definition) => definition.separateBy?.kind !== 'COLUMN' || definition.columns.some((column) => definition.separateBy?.kind === 'COLUMN' && column.header === definition.separateBy.header), {
    message: 'Separate by one of the columns',
    path: ['separateBy'],
  });
export type SaveExportDefinitionRequest = z.infer<typeof saveExportDefinitionRequestSchema>;

export const exportDefinitionResponseSchema = z.object({
  id: uuidSchema,
  workflowId: uuidSchema,
  workflowName: z.string(),
  companyId: uuidSchema.nullable(),
  name: z.string(),
  format: z.enum(['CSV', 'XLSX']),
  sheetName: z.string(),
  delimiter: z.string(),
  trigger: z.enum(['TRANSITION', 'CLOSING']),
  transitionLabel: z.string().nullable(),
  filter: z.array(exportFilterRuleSchema),
  mergeBy: z.string().nullable(),
  separateBy: exportSeparationSchema.nullable(),
  schedule: z.object({ cutoffTime: z.string(), frequency: z.enum(EXPORT_FREQUENCIES), weekdays: z.array(z.number()), monthDay: z.number().nullable(), intervalDays: z.number().nullable() }),
  isActive: z.boolean(),
  columns: z.array(z.object({ header: z.string(), sourceType: z.enum(EXPORT_COLUMN_SOURCES), sourceRef: z.string().nullable(), format: z.enum(EXPORT_VALUE_FORMATS).nullable() })),
  /** Lines written and not in a file yet. */
  pendingLines: z.number().int(),
  lastAutoCutoffAt: z.string().nullable(),
  /** When the scheduled cutoff runs next (company time), `null` when inactive. */
  nextCutoffAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ExportDefinitionResponse = z.infer<typeof exportDefinitionResponseSchema>;

/** One file of a cutoff. `groupLabel` names its group when the definition separates files. */
export const exportCutoffResponseSchema = z.object({
  id: uuidSchema,
  definitionId: uuidSchema,
  definitionName: z.string(),
  cutoffDate: z.string(),
  generatedAt: z.string(),
  generatedBy: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  isManual: z.boolean(),
  lineCount: z.number().int(),
  groupLabel: z.string().nullable(),
  responsibleId: uuidSchema.nullable(),
  hasFile: z.boolean(),
});
export type ExportCutoffResponse = z.infer<typeof exportCutoffResponseSchema>;

/** `POST /exports/:id/cutoffs`: the files made now, and how many lines still wait (a step's responsible not assigned yet). */
export const generateExportCutoffResponseSchema = z.object({ cutoffs: z.array(exportCutoffResponseSchema), waitingLines: z.number().int() });
export type GenerateExportCutoffResponse = z.infer<typeof generateExportCutoffResponseSchema>;

export const exportLineResponseSchema = z.object({
  id: uuidSchema,
  ticketId: uuidSchema,
  ticketNumber: z.string(),
  data: z.record(z.string(), z.string()),
  cutoffId: uuidSchema.nullable(),
  createdAt: z.string(),
});
export type ExportLineResponse = z.infer<typeof exportLineResponseSchema>;

/** `GET /exports/:id/preview`: how a row would come out for the most recent ticket of the workflow (none: empty). */
export const exportPreviewResponseSchema = z.object({ ticketNumber: z.string().nullable(), row: z.record(z.string(), z.string()) });
export type ExportPreviewResponse = z.infer<typeof exportPreviewResponseSchema>;

/** A translation table for CATALOG columns: what the ticket says, and what the file must say instead. */
export const exportCatalogEntrySchema = z.object({ inputValue: z.string().trim().min(1).max(500), outputValue: z.string().trim().max(500) }).strict();
export const saveExportCatalogRequestSchema = z
  .object({ entries: z.array(exportCatalogEntrySchema).max(2000) })
  .strict()
  .refine((body) => new Set(body.entries.map((entry) => entry.inputValue.toLowerCase())).size === body.entries.length, { message: 'Each value appears once', path: ['entries'] });
export type SaveExportCatalogRequest = z.infer<typeof saveExportCatalogRequestSchema>;
export const exportCatalogNameSchema = z.string().regex(CATALOG_NAME);
export const exportCatalogResponseSchema = z.object({ catalog: z.string(), entries: z.array(z.object({ inputValue: z.string(), outputValue: z.string() })) });
export type ExportCatalogResponse = z.infer<typeof exportCatalogResponseSchema>;

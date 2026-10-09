import { z } from 'zod';
import { nameSchema, pageQuerySchema } from '../common.js';
import { uuidSchema } from '../ids.js';

/**
 * Datasets: a spreadsheet loaded as the source of a field's values (the old `tm_data_excel`). The administrator uploads
 * the `.xlsx` with the two-phase upload and then points at it; the first sheet is read, its first row being the headers.
 */

/** The longest column name, the same limit as a field's `dataSource.column`. */
export const DATASET_MAX_COLUMN_NAME = 200;
export const DATASET_MAX_COLUMNS = 50;
export const DATASET_MAX_ROWS = 20_000;
/** The longest text kept from one cell. */
export const DATASET_MAX_CELL_CHARACTERS = 1_000;

const columnNameSchema = z.string().trim().min(1).max(DATASET_MAX_COLUMN_NAME);

export const createDatasetRequestSchema = z.object({
  name: nameSchema,
  /** A confirmed `.xlsx` upload of the caller. */
  fileId: uuidSchema,
  /** Only fields of this workflow may use it; without it, any workflow of the tenant may. Fixed once created. */
  workflowId: uuidSchema.optional(),
  /** The column a field looks a row up by (e.g. the ID number); its values must be unique. */
  keyColumn: columnNameSchema.optional(),
});
export type CreateDatasetRequest = z.infer<typeof createDatasetRequestSchema>;

/** Replaces every row with the content of a new upload; the name and the workflow stay. */
export const reloadDatasetRequestSchema = z.object({ fileId: uuidSchema, keyColumn: columnNameSchema.optional() });
export type ReloadDatasetRequest = z.infer<typeof reloadDatasetRequestSchema>;

export const updateDatasetRequestSchema = z
  .object({ name: nameSchema, isActive: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field');
export type UpdateDatasetRequest = z.infer<typeof updateDatasetRequestSchema>;

export const datasetListQuerySchema = pageQuerySchema.extend({ workflowId: uuidSchema.optional() });
export type DatasetListQuery = z.infer<typeof datasetListQuerySchema>;

export const datasetRowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type DatasetRowsQuery = z.infer<typeof datasetRowsQuerySchema>;

export interface DatasetColumn {
  readonly name: string;
  readonly isKey: boolean;
}

export interface DatasetResponse {
  readonly id: string;
  readonly name: string;
  readonly workflowId: string | null;
  readonly columns: readonly DatasetColumn[];
  readonly keyColumn: string | null;
  readonly rowCount: number;
  readonly sourceFileName: string | null;
  readonly loadedAt: string;
  readonly isActive: boolean;
}

/** A row as loaded: every value is text (numbers and dates are written as the spreadsheet showed them). */
export type DatasetRowData = Readonly<Record<string, string>>;

/** What a person filling a form may ask of a field fed by a dataset. */
export const datasetOptionsQuerySchema = z.object({ q: z.string().trim().max(100).default(''), limit: z.coerce.number().int().min(1).max(50).default(20) });
export type DatasetOptionsQuery = z.infer<typeof datasetOptionsQuerySchema>;

export const datasetLookupQuerySchema = z.object({ key: z.string().trim().min(1).max(DATASET_MAX_CELL_CHARACTERS) });
export type DatasetLookupQuery = z.infer<typeof datasetLookupQuerySchema>;

/** The distinct values of the field's column that contain the text, in alphabetical order. */
export interface DatasetOptionsResponse {
  readonly values: readonly string[];
}

/** The value of the field's column in the row whose key is the one asked for; `null` when no row has that key. */
export interface DatasetLookupResponse {
  readonly value: string | null;
}

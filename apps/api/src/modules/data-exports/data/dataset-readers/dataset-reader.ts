import type { Prisma } from '@procesabpm/db';
import type { ExportDatasetName } from '../../domain/export-datasets.js';

/** A value of a dataset's key column, as the query returns it (uuid and text as strings, integers as numbers). */
export type KeyValue = string | number;

/**
 * One page of a dataset: rows of the tenant after `after` in key order, at most `limit`. A tagged template with a fixed
 * column list (never `SELECT *`, never SQL built from text) that also filters `tenant_id` explicitly, on top of RLS.
 */
export interface DatasetReader {
  /** Key values that sort before every row: the first page starts after them. */
  readonly start: readonly KeyValue[];
  page(tenantId: string, after: readonly KeyValue[], limit: number): Prisma.Sql;
}

export type DatasetReaders<N extends ExportDatasetName> = Readonly<Record<N, DatasetReader>>;

/** Sorts before every uuidv7. */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const MIN_INT = -2_147_483_648;

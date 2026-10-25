import type { DatasetResponse, FieldDocument } from '@procesabpm/shared';

/** What a field's code and a column name are compared as: no accents, capitals, anything else an underscore. */
export function comparableName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The types an Excel lookup can fill: what the person would otherwise type. */
const FILLABLE: ReadonlySet<FieldDocument['type']> = new Set(['TEXT']);

export interface DatasetMatch {
  readonly field: FieldDocument;
  readonly column: string;
}

/**
 * The fields of a form whose code is the name of a column of the Excel (as the help desk's "campo trigger" does): the
 * ones it can fill once the key is typed in `keyCode`, and the ones that match but whose type it cannot fill. The key
 * field and the key column are never filled.
 */
export function datasetMatches(fields: readonly FieldDocument[], dataset: Pick<DatasetResponse, 'columns'>, keyCode: string): { fillable: DatasetMatch[]; unsupported: DatasetMatch[] } {
  const columns = new Map(dataset.columns.filter((column) => !column.isKey).map((column) => [comparableName(column.name), column.name]));
  const fillable: DatasetMatch[] = [];
  const unsupported: DatasetMatch[] = [];
  for (const field of fields) {
    if (field.code === keyCode) continue;
    const column = columns.get(comparableName(field.code));
    if (column === undefined) continue;
    (FILLABLE.has(field.type) ? fillable : unsupported).push({ field, column });
  }
  return { fillable, unsupported };
}

/** Whether the field already looks its value up in that column by that key. */
export function isFilledFrom(field: FieldDocument, datasetId: string, column: string, keyCode: string): boolean {
  const source = field.dataSource as Record<string, unknown> | null;
  return source?.['kind'] === 'DATASET' && source['datasetId'] === datasetId && source['column'] === column && source['lookupFieldCode'] === keyCode;
}

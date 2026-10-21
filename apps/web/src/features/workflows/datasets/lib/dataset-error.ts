import { ApiError, type GenericErrorMessage, genericErrorMessage } from '@/shared/api';
import { StorageUploadError } from '@/shared/files/upload-files';

const FORBIDDEN = 403;
const NOT_FOUND = 404;

/** What was being done: a field using the dataset blocks a delete, and a reload only when it drops what a field reads. */
export type DatasetErrorContext = 'upload' | 'save' | 'delete';

export const FILE_PROBLEMS = [
  'NOT_XLSX',
  'UNREADABLE',
  'TOO_LARGE_UNZIPPED',
  'NO_HEADERS',
  'EMPTY_HEADER',
  'DUPLICATE_HEADER',
  'HEADER_TOO_LONG',
  'TOO_MANY_COLUMNS',
  'TOO_MANY_ROWS',
  'CELL_TOO_LONG',
  'NO_ROWS',
  'KEY_COLUMN_UNKNOWN',
  'KEY_VALUE_MISSING',
  'KEY_VALUE_REPEATED',
] as const;
type FileProblem = (typeof FILE_PROBLEMS)[number];

export type DatasetErrorKey =
  | `datasets.errors.file.${FileProblem}`
  | 'datasets.errors.nameTaken'
  | 'datasets.errors.inUse'
  | 'datasets.errors.columnsInUse'
  | 'datasets.errors.uploadFailed'
  | 'datasets.errors.fileRejected'
  | 'datasets.errors.notFound'
  | 'datasets.errors.forbidden';

export type DatasetErrorMessage =
  | { readonly namespace: 'workflows'; readonly key: DatasetErrorKey; readonly values?: { readonly detail?: string; readonly columns?: string } }
  | ({ readonly namespace: 'common' } & GenericErrorMessage);

const detailsOf = (error: ApiError): Readonly<Record<string, unknown>> => (typeof error.details === 'object' && error.details !== null ? (error.details as Record<string, unknown>) : {});

/** A row number or a limit reads as people write it ("20.000"); a column name stays as it is. */
const detailText = (detail: unknown): string => (typeof detail === 'number' ? detail.toLocaleString('es-CO') : String(detail ?? ''));

/** Never the API's own text: a key of the `workflows` namespace (with the column, row or limit the API named), or the generic message. */
export function datasetErrorMessage(error: unknown, context: DatasetErrorContext): DatasetErrorMessage {
  if (error instanceof StorageUploadError) return { namespace: 'workflows', key: 'datasets.errors.uploadFailed' };
  if (error instanceof ApiError) {
    const details = detailsOf(error);
    if (error.code === 'DATASET_FILE_INVALID') {
      const problem = FILE_PROBLEMS.find((candidate) => candidate === details['problem']);
      if (problem !== undefined) return { namespace: 'workflows', key: `datasets.errors.file.${problem}`, values: { detail: detailText(details['detail']) } };
    }
    if (error.code === 'DATASET_IN_USE') {
      const columns = Array.isArray(details['columns']) ? details['columns'].map(String) : [];
      return context === 'delete' || columns.length === 0
        ? { namespace: 'workflows', key: 'datasets.errors.inUse' }
        : { namespace: 'workflows', key: 'datasets.errors.columnsInUse', values: { columns: columns.map((column) => `«${column}»`).join(', ') } };
    }
    if (error.code === 'DUPLICATE') return { namespace: 'workflows', key: 'datasets.errors.nameTaken' };
    if (error.code === 'FILE_REJECTED') return { namespace: 'workflows', key: 'datasets.errors.fileRejected' };
    if (error.status === FORBIDDEN) return { namespace: 'workflows', key: 'datasets.errors.forbidden' };
    if (error.status === NOT_FOUND) return { namespace: 'workflows', key: 'datasets.errors.notFound' };
  }
  return { namespace: 'common', ...genericErrorMessage(error) };
}

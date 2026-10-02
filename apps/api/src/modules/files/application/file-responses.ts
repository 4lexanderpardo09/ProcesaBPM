import { type FileKind, kindOfMime, type StoredFileResponse } from '@procesabpm/shared';
import type { StoredFileRow } from '../data/stored-file.repository.js';

export const kindOf = (row: Pick<StoredFileRow, 'mimeType'>): FileKind | undefined => kindOfMime(row.mimeType);

export const toStoredFileResponse = (row: StoredFileRow): StoredFileResponse => ({
  id: row.id,
  name: row.originalName,
  kind: kindOf(row) ?? 'OFFICE',
  mimeType: row.mimeType,
  sizeBytes: Number(row.sizeBytes),
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  confirmedAt: row.confirmedAt?.toISOString() ?? null,
});

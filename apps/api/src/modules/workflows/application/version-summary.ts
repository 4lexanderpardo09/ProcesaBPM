import type { VersionSummary } from '@procesabpm/shared';
import type { VersionRow } from '../data/workflow.repository.js';

export const toVersionSummary = (row: VersionRow): VersionSummary => ({
  id: row.id,
  number: row.number,
  status: row.status,
  notes: row.notes,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  publishedById: row.publishedById,
  createdAt: row.createdAt.toISOString(),
});

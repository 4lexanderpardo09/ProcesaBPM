import type { BatchGroupBy, FieldDocument, FieldType, StepDocument } from '@procesabpm/shared';
import type { BatchTicketRow } from '../data/batch-tickets.repository.js';


export interface BatchTray {
  readonly title: string | null;
  readonly shownFields: Array<{ code: string; label: string; type: FieldType; config: Record<string, unknown> }>;
  readonly groupBy: BatchGroupBy | null;
}

/** What of a field's settings the tray needs to write its value (options, currency, decimals, a formula's result). */
const READ_KEYS = ['options', 'currencyCode', 'decimals', 'resultType'] as const;

/** How the step's tray reads (`config.batch`): a field it names that the version lacks is left out. */
export function batchTrayOf(step: StepDocument, fields: readonly FieldDocument[]): BatchTray {
  const batch = (step.config.batch ?? {}) as { title?: string; showFields?: string[]; groupBy?: BatchGroupBy };
  const shownFields = (batch.showFields ?? []).flatMap((code) => {
    const field = fields.find((candidate) => candidate.code === code);
    if (field === undefined) return [];
    const config = Object.fromEntries(READ_KEYS.flatMap((key) => (field.config[key] === undefined ? [] : [[key, field.config[key]]])));
    return [{ code, label: field.label, type: field.type, config }];
  });
  return { title: batch.title ?? null, shownFields, groupBy: batch.groupBy ?? null };
}

/** The part of the tray a ticket falls in. `key` `''` is "none": no site, no department, not in any file yet. */
export function batchSubgroupOf(groupBy: BatchGroupBy | null, row: BatchTicketRow): { key: string; name: string } | null {
  switch (groupBy) {
    case null:
      return null;
    case 'COMPANY':
      return { key: row.company.id, name: row.company.name };
    case 'REQUESTER_SITE':
      return row.site === null ? { key: '', name: '' } : { key: row.site.id, name: row.site.name };
    case 'REQUESTER_DEPARTMENT':
      return row.department === null ? { key: '', name: '' } : { key: row.department.id, name: row.department.name };
    case 'EXPORT_CUTOFF': {
      const cutoff = row.cutoff;
      if (cutoff === null) return { key: '', name: '' };
      const parts = [cutoff.definitionName, cutoff.cutoffDate.toISOString().slice(0, 10), cutoff.groupLabel].filter((part): part is string => part !== null && part !== '');
      return { key: cutoff.id, name: parts.join(' · ') };
    }
  }
}

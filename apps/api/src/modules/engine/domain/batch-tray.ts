import type { BatchGroupBy, FieldDocument, FieldType, StepDocument } from '@procesabpm/shared';
import type { BatchTicketRow } from '../data/batch-tickets.repository.js';


interface TrayField {
  code: string;
  label: string;
  type: FieldType;
  config: Record<string, unknown>;
}

export interface BatchTray {
  readonly title: string | null;
  readonly shownFields: TrayField[];
  readonly groupBy: BatchGroupBy | null;
  readonly groupField: TrayField | null;
}

/** What of a field's settings the tray needs to write its value (options, currency, decimals, a formula's result). */
const READ_KEYS = ['options', 'currencyCode', 'decimals', 'resultType'] as const;

/**
 * How the step's tray reads (`config.batch`): a field it names that the version lacks is left out, and grouping by a
 * field the version lacks keeps the tickets in one list.
 */
export function batchTrayOf(step: StepDocument, fields: readonly FieldDocument[]): BatchTray {
  const batch = (step.config.batch ?? {}) as { title?: string; showFields?: string[]; groupBy?: BatchGroupBy; groupFieldCode?: string };
  const shownFields = (batch.showFields ?? []).flatMap((code) => {
    const field = trayField(code, fields);
    return field === null ? [] : [field];
  });
  const groupField = batch.groupBy === 'FIELD' && batch.groupFieldCode !== undefined ? trayField(batch.groupFieldCode, fields) : null;
  const groupBy = batch.groupBy === 'FIELD' && groupField === null ? null : (batch.groupBy ?? null);
  return { title: batch.title ?? null, shownFields, groupBy, groupField };
}

function trayField(code: string, fields: readonly FieldDocument[]): TrayField | null {
  const field = fields.find((candidate) => candidate.code === code);
  if (field === undefined) return null;
  const config = Object.fromEntries(READ_KEYS.flatMap((key) => (field.config[key] === undefined ? [] : [[key, field.config[key]]])));
  return { code, label: field.label, type: field.type, config };
}

/**
 * The part of the tray a ticket falls in. `key` `''` is "none": no site, no department, not in any file yet, no value.
 * By a field, the key is its value as JSON and the name its plain text; the web writes it by the field's type.
 */
export function batchSubgroupOf(tray: Pick<BatchTray, 'groupBy' | 'groupField'>, row: BatchTicketRow): { key: string; name: string } | null {
  switch (tray.groupBy) {
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
    case 'FIELD': {
      const value = tray.groupField === null ? undefined : row.values[tray.groupField.code];
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return { key: '', name: '' };
      return { key: JSON.stringify(value), name: Array.isArray(value) ? value.map(String).join(', ') : String(value) };
    }
  }
}

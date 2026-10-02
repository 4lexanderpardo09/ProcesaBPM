import type { FieldValueIssue } from '@procesabpm/shared';

export interface FieldFileChange {
  readonly fieldCode: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

const asIds = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/**
 * What a submission does to the FILE fields it carries: ids that appear are added, ids that were stored and no
 * longer appear are removed (they stay in the ticket's history). Fields the submission did not carry are untouched.
 */
export function diffFieldFiles(fileFieldCodes: readonly string[], submitted: Readonly<Record<string, unknown>>, existing: Readonly<Record<string, unknown>>): FieldFileChange[] {
  return fileFieldCodes
    .filter((code) => Object.hasOwn(submitted, code))
    .map((code) => {
      const now = asIds(submitted[code]);
      const before = asIds(existing[code]);
      return { fieldCode: code, added: now.filter((id) => !before.includes(id)), removed: before.filter((id) => !now.includes(id)) };
    })
    .filter((change) => change.added.length > 0 || change.removed.length > 0);
}

/** A file that appears twice among the added ones (two fields, or a field and a loose attachment) can only be attached once. */
export function findRepeatedFiles(changes: readonly FieldFileChange[], attachmentIds: readonly string[]): FieldValueIssue[] {
  const seen = new Set(attachmentIds);
  const issues: FieldValueIssue[] = [];
  for (const change of changes) {
    for (const id of change.added) {
      if (seen.has(id)) issues.push({ code: 'FILE_NOT_ATTACHABLE', fieldCode: change.fieldCode });
      seen.add(id);
    }
  }
  return issues;
}

import { type FieldDocument, type FieldValueIssue, fileIdsOf } from '@procesabpm/shared';

export interface FieldFileChange {
  readonly fieldCode: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** A field whose value holds files: a FILE field, or a TABLE with file columns (`holdsFiles`). */
export type FileField = Pick<FieldDocument, 'code' | 'type' | 'config'>;

/**
 * What a submission does to the fields with files it carries: ids that appear are added, ids that were stored and no
 * longer appear are removed (they stay in the ticket's history). Fields the submission did not carry are untouched. A
 * table's files, whatever their row, belong to the table's code.
 */
export function diffFieldFiles(fileFields: readonly FileField[], submitted: Readonly<Record<string, unknown>>, existing: Readonly<Record<string, unknown>>): FieldFileChange[] {
  return fileFields
    .filter((field) => Object.hasOwn(submitted, field.code))
    .map((field) => {
      const now = fileIdsOf(field, submitted[field.code]);
      const before = fileIdsOf(field, existing[field.code]);
      return { fieldCode: field.code, added: now.filter((id) => !before.includes(id)), removed: before.filter((id) => !now.includes(id)) };
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

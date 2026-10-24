import type { FormFieldResponse } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cellIssuesOf, type FieldIssueKey, fieldIssuesOf } from '../lib/field-issues';
import { columnsOf, initialInput, type InputValue, isBlankInput, requestValue, type TableRow } from '../lib/step-values';
import { useDatasetLookups } from './use-dataset-lookups';

export type CollectedValues = { readonly ok: true; readonly values: Record<string, unknown> } | { readonly ok: false };

/**
 * The values a person types in a set of workflow fields (a step being answered, or the START of a new ticket): what
 * each input holds, what is wrong with it (checked here before sending, or said by the API in `error`), and whether a
 * file is still uploading. `collect` turns the inputs into the API's values, or marks what has to be fixed.
 */
export function useStepFields(fields: readonly FormFieldResponse[], initialValues: Readonly<Record<string, unknown>>, error: unknown) {
  const { t } = useTranslation('tickets');
  const [inputs, setInputs] = useState<Record<string, InputValue>>(() => Object.fromEntries(fields.map((field) => [field.code, initialInput(field, initialValues[field.code])])));
  const [localIssues, setLocalIssues] = useState<ReadonlyMap<string, FieldIssueKey>>(new Map());
  const [uploading, setUploading] = useState<ReadonlySet<string>>(new Set());
  useDatasetLookups(fields, inputs, (code, value) => setInputs((current) => ({ ...current, [code]: value })));
  const serverIssues = fieldIssuesOf(error);
  const cellIssues = cellIssuesOf(error);

  /** A rejected table cell says where it is; any other issue says what is wrong. */
  const messageOf = (field: FormFieldResponse): string | undefined => {
    const cell = localIssues.has(field.code) ? undefined : cellIssues.get(field.code);
    if (cell !== undefined) {
      const column = columnsOf(field).find((candidate) => candidate.code === cell.column)?.label ?? cell.column;
      return t('advance.table.cellIssue', { row: cell.row + 1, column, issue: t(`advance.issues.${cell.key}`) });
    }
    const issue = localIssues.get(field.code) ?? serverIssues?.get(field.code);
    return issue === undefined ? undefined : t(`advance.issues.${issue}`);
  };

  return {
    /** A file is on its way: its id does not exist yet, so nothing can be sent. */
    busy: uploading.size > 0,
    /** The API rejected some field values (`FIELD_VALUES_INVALID`): the error is shown on the fields, not as a whole. */
    rejected: serverIssues !== undefined,
    inputProps: (field: FormFieldResponse) => ({
      value: inputs[field.code] ?? '',
      error: messageOf(field),
      onChange: (value: InputValue) => {
        setInputs((current) => ({ ...current, [field.code]: value }));
        setLocalIssues((current) => withoutIssue(current, field.code));
      },
      onBusyChange: (busy: boolean) => setUploading((current) => withBusy(current, field.code, busy)),
    }),
    /**
     * What is typed so far, as the API's values, without checking or marking anything: for a preview of where the
     * answer goes. A blank or not yet valid input is left out.
     */
    draft(): Record<string, unknown> {
      const values: Record<string, unknown> = {};
      for (const field of fields) {
        const input = inputs[field.code] ?? '';
        if (isBlankInput(input)) continue;
        const value = requestValue(field, input);
        if (value.ok) values[field.code] = value.value;
      }
      return values;
    },
    collect(): CollectedValues {
      // Blank table rows are not sent: dropping them here too keeps the rows the API names in step with the screen.
      const sent = withoutBlankRows(fields, inputs);
      setInputs(sent);
      const issues = new Map<string, FieldIssueKey>();
      const values: Record<string, unknown> = {};
      for (const field of fields) {
        const input = sent[field.code] ?? '';
        // «Fecha actual»: left empty, the API puts the moment it is sent.
        if (field.isRequired && isBlankInput(input) && field.config['defaultNow'] !== true) issues.set(field.code, 'REQUIRED');
        const value = requestValue(field, input);
        if (value.ok) values[field.code] = value.value;
        else issues.set(field.code, 'INVALID_TYPE');
      }
      setLocalIssues(issues);
      return issues.size === 0 ? { ok: true, values } : { ok: false };
    },
  };
}

/** The fields a person fills (computed ones are never typed), in the builder's order. */
export function typedFields(fields: readonly FormFieldResponse[]): readonly FormFieldResponse[] {
  return fields.filter((field) => !field.isReadOnly && field.type !== 'FORMULA' && field.type !== 'CALCULATOR').sort((left, right) => left.sortOrder - right.sortOrder);
}

function withBusy(busy: ReadonlySet<string>, code: string, isBusy: boolean): ReadonlySet<string> {
  const next = new Set(busy);
  if (isBusy) next.add(code);
  else next.delete(code);
  return next;
}

function withoutBlankRows(fields: readonly FormFieldResponse[], inputs: Readonly<Record<string, InputValue>>): Record<string, InputValue> {
  const next: Record<string, InputValue> = { ...inputs };
  for (const field of fields) {
    const rows = inputs[field.code];
    if (field.type === 'TABLE' && Array.isArray(rows)) next[field.code] = (rows as readonly TableRow[]).filter((row) => !isBlankInput([row]));
  }
  return next;
}

function withoutIssue(issues: ReadonlyMap<string, FieldIssueKey>, code: string): ReadonlyMap<string, FieldIssueKey> {
  if (!issues.has(code)) return issues;
  const next = new Map(issues);
  next.delete(code);
  return next;
}

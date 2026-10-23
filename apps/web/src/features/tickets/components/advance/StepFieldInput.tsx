import type { FormFieldResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { useApiClient } from '@/shared/session';
import { Checkbox, Select, TextArea, TextField } from '@/shared/ui';
import { fieldChoicesQueryOptions } from '../../api/field-choices-api';
import { choiceSourceOf, type InputValue, optionsOf, type TableRow } from '../../lib/step-values';
import styles from './AdvanceDialog.module.css';
import { ChoicePicker } from './ChoicePicker';
import { FileInput } from './FileInput';
import { TableInput } from './TableInput';

export interface StepFieldInputProps {
  readonly field: FormFieldResponse;
  readonly value: InputValue;
  readonly error: string | undefined;
  /** Names already known for ids the ticket holds (people, sites and preset entries). */
  readonly knownLabels: Readonly<Record<string, string>>;
  /** Names of the files the ticket already has, by id. */
  readonly knownFiles: Readonly<Record<string, string>>;
  readonly onChange: (value: InputValue) => void;
  /** A file field says when an upload starts and ends. */
  readonly onBusyChange: (busy: boolean) => void;
}

/** One field of the step, with the input its type needs; a field the web cannot capture yet says so. */
export function StepFieldInput({ field, value, error, knownLabels, knownFiles, onChange, onBusyChange }: StepFieldInputProps) {
  const { t } = useTranslation('tickets');
  const common = { label: field.label, required: field.isRequired, error };
  const text = typeof value === 'string' ? value : '';
  const config = field.config;

  const source = choiceSourceOf(field);
  if (field.type === 'FILE') return <FileInput field={field} value={Array.isArray(value) ? (value as readonly string[]) : []} knownNames={knownFiles} error={error} onChange={onChange} onBusyChange={onBusyChange} />;
  if (field.type === 'TABLE') return <TableInput field={field} rows={Array.isArray(value) ? (value as readonly TableRow[]) : []} error={error} onChange={onChange} />;
  if (source === 'DATASET' && field.type === 'TEXT') return <DatasetText field={field} value={text} error={error} onChange={onChange} />;
  if (source !== undefined) {
    const chosen = field.type === 'MULTI_SELECT' ? (Array.isArray(value) ? (value as readonly string[]) : []) : text;
    return <ChoicePicker field={field} source={source} value={chosen} knownLabels={knownLabels} error={error} onChange={onChange} />;
  }
  switch (field.type) {
    case 'TEXTAREA':
      return <TextArea {...common} value={text} rows={3} maxLength={numberOf(config['maxLength']) ?? 10_000} onChange={(event) => onChange(event.target.value)} />;
    case 'NUMBER':
    case 'CURRENCY':
      return <TextField {...common} value={text} inputMode="decimal" hint={field.type === 'CURRENCY' ? stringOf(config['currencyCode']) : undefined} onChange={(event) => onChange(event.target.value)} />;
    case 'DAYS':
      return <TextField {...common} value={text} inputMode="numeric" hint={t('advance.daysHint')} onChange={(event) => onChange(event.target.value)} />;
    case 'DATE':
      return <TextField {...common} type="date" value={text} hint={config['defaultNow'] === true ? t('advance.defaultToday') : undefined} onChange={(event) => onChange(event.target.value)} />;
    case 'DATETIME':
      return <TextField {...common} type="datetime-local" value={text} hint={config['defaultNow'] === true ? t('advance.defaultNow') : undefined} onChange={(event) => onChange(event.target.value)} />;
    case 'SELECT':
      return <Select {...common} value={text} placeholder={t('advance.choose')} options={optionsOf(field)} onChange={(event) => onChange(event.target.value)} />;
    case 'MULTI_SELECT':
      return <MultiSelect field={field} selected={Array.isArray(value) ? (value as readonly string[]) : []} error={error} onChange={onChange} />;
    default:
      return <TextField {...common} value={text} maxLength={numberOf(config['maxLength']) ?? 1000} placeholder={stringOf(config['placeholder'])} onChange={(event) => onChange(event.target.value)} />;
  }
}

/** Free text with the dataset column's values as suggestions; the API checks that the text is one of them. */
function DatasetText({ field, value, error, onChange }: { readonly field: FormFieldResponse; readonly value: string; readonly error: string | undefined; readonly onChange: (value: InputValue) => void }) {
  const listId = useId();
  const suggestions = useQuery(fieldChoicesQueryOptions(useApiClient(), field.id, 'DATASET', useDebouncedValue(value.trim(), 300)));
  return (
    <>
      <TextField label={field.label} required={field.isRequired} error={error} value={value} list={listId} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
      <datalist id={listId}>
        {(suggestions.data ?? []).map((option) => (
          <option key={option.value} value={option.value} />
        ))}
      </datalist>
    </>
  );
}

function MultiSelect({ field, selected, error, onChange }: { readonly field: FormFieldResponse; readonly selected: readonly string[]; readonly error: string | undefined; readonly onChange: (value: InputValue) => void }) {
  const toggle = (value: string, checked: boolean) => onChange(checked ? [...selected, value] : selected.filter((entry) => entry !== value));
  return (
    <fieldset className={styles.choices} aria-invalid={error !== undefined}>
      <legend className="text-label">
        {field.label}
        {field.isRequired && <span aria-hidden="true"> *</span>}
      </legend>
      {optionsOf(field).map((option) => (
        <Checkbox key={option.value} label={option.label} checked={selected.includes(option.value)} onChange={(event) => toggle(option.value, event.target.checked)} />
      ))}
      {error !== undefined && <span className={styles.pendingError}>{error}</span>}
    </fieldset>
  );
}

const numberOf = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const stringOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

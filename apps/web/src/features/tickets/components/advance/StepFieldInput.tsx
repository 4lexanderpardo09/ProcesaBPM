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
  /** What the rest of the form holds, by field code: «Días fuera» lists the days between two of its dates. */
  readonly formInputs?: Readonly<Record<string, InputValue>>;
  /** A file field says when an upload starts and ends. */
  readonly onBusyChange: (busy: boolean) => void;
}

/** One field of the step, with the input its type needs; a field the web cannot capture yet says so. */
export function StepFieldInput({ field, value, error, knownLabels, knownFiles, onChange, onBusyChange, formInputs = {} }: StepFieldInputProps) {
  const { t } = useTranslation('tickets');
  const common = { label: field.label, required: field.isRequired, error };
  const text = typeof value === 'string' ? value : '';
  const config = field.config;

  const source = choiceSourceOf(field);
  if (field.type === 'FILE') return <FileInput field={field} value={Array.isArray(value) ? (value as readonly string[]) : []} knownNames={knownFiles} error={error} onChange={onChange} onBusyChange={onBusyChange} />;
  if (field.type === 'TRIP_DAYS') return <TripDays field={field} atHome={Array.isArray(value) ? (value as readonly string[]) : []} formInputs={formInputs} error={error} onChange={onChange} />;
  if (field.type === 'TABLE') return <TableInput field={field} rows={Array.isArray(value) ? (value as readonly TableRow[]) : []} error={error} onChange={onChange} knownFiles={knownFiles} onBusyChange={onBusyChange} />;
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

/** The longest trip listed day by day (the API keeps at most 92 days). */
const MAX_TRIP_DAYS = 92;
const LOCAL_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const DAY_LABEL = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** The local days from one date input to another, both included; empty while either is missing or they are reversed. */
export function tripDaysBetween(start: InputValue | undefined, end: InputValue | undefined): readonly string[] {
  const first = typeof start === 'string' ? LOCAL_DAY.exec(start.trim()) : null;
  const last = typeof end === 'string' ? LOCAL_DAY.exec(end.trim()) : null;
  if (first === null || last === null) return [];
  const days: string[] = [];
  const day = new Date(Date.UTC(Number(first[1]), Number(first[2]) - 1, Number(first[3])));
  const until = Date.UTC(Number(last[1]), Number(last[2]) - 1, Number(last[3]));
  while (day.getTime() <= until && days.length < MAX_TRIP_DAYS) {
    days.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return days;
}

/**
 * «Días fuera», as in the help desk: one box per day of the trip, all ticked; the person unticks the days they were not
 * away, and those are what is kept (the meal calculator pays nothing on them).
 */
function TripDays({ field, atHome, formInputs, error, onChange }: { readonly field: FormFieldResponse; readonly atHome: readonly string[]; readonly formInputs: Readonly<Record<string, InputValue>>; readonly error: string | undefined; readonly onChange: (value: InputValue) => void }) {
  const { t } = useTranslation('tickets');
  const days = tripDaysBetween(formInputs[stringOf(field.config['startFieldCode']) ?? ''], formInputs[stringOf(field.config['endFieldCode']) ?? '']);
  const toggle = (day: string, away: boolean) => onChange(away ? atHome.filter((entry) => entry !== day) : [...atHome, day].sort());
  return (
    <fieldset className={styles.choices} aria-invalid={error !== undefined}>
      <legend className="text-label">{field.label}</legend>
      {days.length === 0 ? (
        <span className="text-caption">{t('advance.tripDays.pending')}</span>
      ) : (
        days.map((day) => (
          <Checkbox key={day} label={DAY_LABEL.format(new Date(`${day}T12:00:00Z`))} checked={!atHome.includes(day)} onChange={(event) => toggle(day, event.target.checked)} />
        ))
      )}
      {error !== undefined && <span className={styles.pendingError}>{error}</span>}
    </fieldset>
  );
}

const numberOf = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const stringOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

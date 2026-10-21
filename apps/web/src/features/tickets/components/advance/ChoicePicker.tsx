import type { FormFieldResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { useApiClient } from '@/shared/session';
import { Button, Select, TextField } from '@/shared/ui';
import { CHOICES_LIMIT, fieldChoicesQueryOptions } from '../../api/field-choices-api';
import type { ChoiceSource, Option } from '../../lib/step-values';
import styles from './AdvanceDialog.module.css';

/** The search waits for the person to pause before asking the API. */
const SEARCH_DELAY_MS = 300;

export interface ChoicePickerProps {
  readonly field: FormFieldResponse;
  readonly source: ChoiceSource;
  /** One id or value, or several for a MULTI_SELECT. */
  readonly value: string | readonly string[];
  /** Names already known for the ticket's values (`valueNames` of the detail). */
  readonly knownLabels: Readonly<Record<string, string>>;
  readonly error: string | undefined;
  readonly onChange: (value: string | readonly string[]) => void;
}

/**
 * A choice among what the API offers for the field (people, sites, preset entries or dataset values). The API brings at
 * most `CHOICES_LIMIT` at a time: a longer list gets a search box that narrows it. A MULTI_SELECT lists what is chosen, each removable.
 */
export function ChoicePicker({ field, source, value, knownLabels, error, onChange }: ChoicePickerProps) {
  const { t } = useTranslation('tickets');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Readonly<Record<string, string>>>({});
  const choices = useQuery(fieldChoicesQueryOptions(useApiClient(), field.id, source, useDebouncedValue(search.trim(), SEARCH_DELAY_MS)));
  const offered = choices.data ?? [];
  const labelOf = (entry: string): string => picked[entry] ?? knownLabels[entry] ?? offered.find((option) => option.value === entry)?.label ?? (source === 'DATASET' ? entry : t('advance.choices.current'));
  const remember = (entry: string) => {
    const option = offered.find((candidate) => candidate.value === entry);
    if (option !== undefined) setPicked((current) => ({ ...current, [entry]: option.label }));
  };
  const status = choices.isError ? t('advance.choices.failed') : choices.data === undefined ? t('advance.choices.loading') : offered.length === 0 ? t('advance.choices.none') : undefined;
  const hint = offered.length >= CHOICES_LIMIT ? t('advance.choices.narrow', { count: CHOICES_LIMIT }) : undefined;
  // A short list is picked as it is; the search only shows once the list is cut at the limit (or was already used).
  const searchable = search !== '' || offered.length >= CHOICES_LIMIT;
  const searchBox = searchable ? <TextField label={t('advance.choices.search', { field: field.label })} type="search" value={search} onChange={(event) => setSearch(event.target.value)} /> : null;

  if (typeof value === 'string') {
    const options: readonly Option[] = value === '' || offered.some((option) => option.value === value) ? offered : [{ value, label: labelOf(value) }, ...offered];
    return (
      <div className={styles.picker}>
        {searchBox}
        <Select
          label={field.label}
          required={field.isRequired}
          value={value}
          placeholder={status ?? t('advance.choose')}
          options={options}
          hint={hint}
          error={error}
          onChange={(event) => {
            remember(event.target.value);
            onChange(event.target.value);
          }}
        />
      </div>
    );
  }
  return <MultiChoice label={field.label} required={field.isRequired} chosen={value} labelOf={labelOf} offered={offered.filter((option) => !value.includes(option.value))} status={status} hint={hint} error={error} searchBox={searchBox} onAdd={(entry) => {
    remember(entry);
    onChange([...value, entry]);
  }} onRemove={(entry) => onChange(value.filter((current) => current !== entry))} />;
}

interface MultiChoiceProps {
  readonly label: string;
  readonly required: boolean;
  readonly chosen: readonly string[];
  readonly labelOf: (value: string) => string;
  readonly offered: readonly Option[];
  readonly status: string | undefined;
  readonly hint: string | undefined;
  readonly error: string | undefined;
  readonly searchBox: ReactNode;
  readonly onAdd: (value: string) => void;
  readonly onRemove: (value: string) => void;
}

function MultiChoice({ label, required, chosen, labelOf, offered, status, hint, error, searchBox, onAdd, onRemove }: MultiChoiceProps) {
  const { t } = useTranslation('tickets');
  const listId = useId();
  return (
    <fieldset className={styles.choices} aria-invalid={error !== undefined}>
      <legend className="text-label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </legend>
      {chosen.length === 0 ? (
        <p className={styles.pendingNote}>{t('advance.choices.noneChosen')}</p>
      ) : (
        <ul id={listId} className={styles.chosen} aria-label={t('advance.choices.chosen', { field: label })}>
          {chosen.map((entry) => (
            <li key={entry} className={styles.chip}>
              <span>{labelOf(entry)}</span>
              <Button variant="ghost" aria-label={t('advance.choices.remove', { value: labelOf(entry) })} onClick={() => onRemove(entry)}>
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      {searchBox}
      <Select label={t('advance.choices.add', { field: label })} value="" placeholder={status ?? t('advance.choices.addPlaceholder')} options={offered} hint={hint} onChange={(event) => event.target.value !== '' && onAdd(event.target.value)} />
      {error !== undefined && <span className={styles.pendingError}>{error}</span>}
    </fieldset>
  );
}

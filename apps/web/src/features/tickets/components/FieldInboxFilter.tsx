import { type FilterableFieldType, type TicketFilterFieldResponse, ticketFilterFieldsResponseSchema } from '@procesabpm/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { HttpClient } from '@/shared/api';
import { useApiClient } from '@/shared/session';
import { Select, TextField } from '@/shared/ui';
import type { FieldOperator, InboxFilters as Filters } from '../lib/inbox-params';
import styles from './InboxFilters.module.css';

const filterFieldsQueryOptions = (client: HttpClient) =>
  queryOptions({
    queryKey: ['tickets', 'filter-fields'] as const,
    queryFn: ({ signal }) => client.request('/tickets/filter-fields', { schema: ticketFilterFieldsResponseSchema, signal }),
    staleTime: 5 * 60_000,
  });

type FieldKind = 'text' | 'choice' | 'number' | 'date';

const KIND_OF: Readonly<Record<FilterableFieldType, FieldKind>> = {
  TEXT: 'text',
  TEXTAREA: 'text',
  SELECT: 'choice',
  NUMBER: 'number',
  CURRENCY: 'number',
  DAYS: 'number',
  FORMULA: 'number',
  DATE: 'date',
  DATETIME: 'date',
};

/** The conditions that make sense for each kind of field, the first one chosen when the field is picked. */
const OPERATORS_OF: Readonly<Record<FieldKind, readonly FieldOperator[]>> = {
  text: ['contains', 'equals', 'filled', 'empty'],
  choice: ['equals', 'filled', 'empty'],
  number: ['equals', 'between', 'filled', 'empty'],
  date: ['overdue', 'upcoming', 'between', 'filled', 'empty'],
};

const DEFAULT_UPCOMING_DAYS = '7';
const CLEARED = { fieldValue: undefined, fieldValueTo: undefined } as const;

export interface FieldInboxFilterProps {
  readonly filters: Filters;
  readonly onChange: (changed: Partial<Filters>) => void;
}

/**
 * A field of the forms by its code (every workflow with that code), a condition fit for its type and the values
 * the condition needs. Typed values apply when the box is left or on Enter, not on every key.
 */
export function FieldInboxFilter({ filters, onChange }: FieldInboxFilterProps) {
  const { t } = useTranslation('tickets');
  const fields = useQuery(filterFieldsQueryOptions(useApiClient()));
  if (fields.data === undefined || (fields.data.length === 0 && filters.fieldCode === undefined)) return null;

  const field = fields.data.find((candidate) => candidate.code === filters.fieldCode);
  const kind: FieldKind = field === undefined ? 'text' : KIND_OF[field.type];
  const operators = OPERATORS_OF[kind];
  const pickField = (code: string) => {
    const picked = fields.data.find((candidate) => candidate.code === code);
    if (picked === undefined) {
      onChange({ fieldCode: undefined, fieldOperator: undefined, ...CLEARED });
      return;
    }
    const operator = OPERATORS_OF[KIND_OF[picked.type]][0]!;
    onChange({ fieldCode: picked.code, fieldOperator: operator, ...CLEARED, ...(operator === 'upcoming' ? { fieldValue: DEFAULT_UPCOMING_DAYS } : {}) });
  };
  const pickOperator = (operator: FieldOperator) => onChange({ fieldOperator: operator, ...CLEARED, ...(operator === 'upcoming' ? { fieldValue: DEFAULT_UPCOMING_DAYS } : {}) });

  return (
    <div className={styles.field} role="group" aria-label={t('filters.field.label')}>
      <Select
        label={t('filters.field.field')}
        placeholder={t('filters.any')}
        options={fields.data.map((candidate) => ({ value: candidate.code, label: candidate.label }))}
        value={filters.fieldCode ?? ''}
        onChange={(event) => pickField(event.target.value)}
      />
      {filters.fieldCode !== undefined && (
        <Select
          label={t('filters.field.operator')}
          options={operators.map((operator) => ({ value: operator, label: t(`filters.field.operators.${operator}`) }))}
          value={filters.fieldOperator !== undefined && operators.includes(filters.fieldOperator) ? filters.fieldOperator : ''}
          placeholder={t('filters.field.chooseOperator')}
          onChange={(event) => pickOperator(event.target.value as FieldOperator)}
        />
      )}
      {filters.fieldCode !== undefined && filters.fieldOperator !== undefined && <FieldValues field={field} kind={kind} filters={filters} onChange={onChange} />}
    </div>
  );
}

interface FieldValuesProps extends FieldInboxFilterProps {
  readonly field: TicketFilterFieldResponse | undefined;
  readonly kind: FieldKind;
}

function FieldValues({ field, kind, filters, onChange }: FieldValuesProps) {
  const { t } = useTranslation('tickets');
  const set = (key: 'fieldValue' | 'fieldValueTo', value: string) => onChange({ [key]: value.trim() === '' ? undefined : value.trim() });
  switch (filters.fieldOperator) {
    case 'contains':
    case 'equals':
      if (kind === 'choice' && field?.options != null && field.options.length > 0) {
        return <Select label={t('filters.field.value')} placeholder={t('filters.any')} options={field.options.map((option) => ({ value: option.value, label: option.label }))} value={filters.fieldValue ?? ''} onChange={(event) => set('fieldValue', event.target.value)} />;
      }
      return <TypedValue label={t('filters.field.value')} type={kind === 'number' ? 'number' : 'text'} value={filters.fieldValue} onCommit={(value) => set('fieldValue', value)} />;
    case 'between':
      if (kind === 'date') {
        return (
          <>
            <TextField label={t('filters.field.from')} type="date" value={filters.fieldValue ?? ''} max={filters.fieldValueTo} onChange={(event) => set('fieldValue', event.target.value)} />
            <TextField label={t('filters.field.to')} type="date" value={filters.fieldValueTo ?? ''} min={filters.fieldValue} onChange={(event) => set('fieldValueTo', event.target.value)} />
          </>
        );
      }
      return (
        <>
          <TypedValue label={t('filters.field.from')} type="number" value={filters.fieldValue} onCommit={(value) => set('fieldValue', value)} />
          <TypedValue label={t('filters.field.to')} type="number" value={filters.fieldValueTo} onCommit={(value) => set('fieldValueTo', value)} />
        </>
      );
    case 'upcoming':
      return <TypedValue label={t('filters.field.days')} type="number" min={0} max={365} value={filters.fieldValue} onCommit={(value) => set('fieldValue', value)} />;
    default:
      return null;
  }
}

interface TypedValueProps {
  readonly label: string;
  readonly type: 'text' | 'number';
  readonly value: string | undefined;
  readonly onCommit: (value: string) => void;
  readonly min?: number;
  readonly max?: number;
}

/** A box that applies its value when left or on Enter; a new value from the URL (back, clear) replaces what was typed. */
function TypedValue({ label, type, value, onCommit, min, max }: TypedValueProps) {
  const commit = (typed: string) => {
    if (typed.trim() !== (value ?? '')) onCommit(typed);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit(event.currentTarget.value);
  };
  return <TextField key={value ?? ''} label={label} type={type} min={min} max={max} maxLength={type === 'text' ? 200 : undefined} step={type === 'number' ? 'any' : undefined} defaultValue={value ?? ''} onBlur={(event) => commit(event.target.value)} onKeyDown={onKeyDown} />;
}

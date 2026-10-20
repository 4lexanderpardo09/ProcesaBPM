import type { FormFieldResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Checkbox, Select, TextArea, TextField } from '@/shared/ui';
import { type InputValue, isCapturable, optionsOf } from '../../lib/step-values';
import styles from './AdvanceDialog.module.css';

export interface StepFieldInputProps {
  readonly field: FormFieldResponse;
  readonly value: InputValue;
  readonly error: string | undefined;
  readonly onChange: (value: InputValue) => void;
}

/** One field of the step, with the input its type needs; a field the web cannot capture yet says so. */
export function StepFieldInput({ field, value, error, onChange }: StepFieldInputProps) {
  const { t } = useTranslation('tickets');
  const common = { label: field.label, required: field.isRequired, error };
  const text = typeof value === 'string' ? value : '';
  const config = field.config;

  if (!isCapturable(field)) {
    return (
      <div className={styles.pending}>
        <span className="text-label">{field.label}</span>
        <span className={styles.pendingNote}>{t('advance.notCapturable')}</span>
        {error !== undefined && <span className={styles.pendingError}>{error}</span>}
      </div>
    );
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
      return <TextField {...common} type="date" value={text} onChange={(event) => onChange(event.target.value)} />;
    case 'DATETIME':
      return <TextField {...common} type="datetime-local" value={text} onChange={(event) => onChange(event.target.value)} />;
    case 'SELECT':
      return <Select {...common} value={text} placeholder={t('advance.choose')} options={optionsOf(field)} onChange={(event) => onChange(event.target.value)} />;
    case 'MULTI_SELECT':
      return <MultiSelect field={field} selected={Array.isArray(value) ? value : []} error={error} onChange={onChange} />;
    default:
      return <TextField {...common} value={text} maxLength={numberOf(config['maxLength']) ?? 1000} placeholder={stringOf(config['placeholder'])} onChange={(event) => onChange(event.target.value)} />;
  }
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

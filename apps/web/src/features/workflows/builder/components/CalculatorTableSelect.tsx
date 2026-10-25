import type { CalculatorDefinition } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Select } from '@/shared/ui';
import { calculatorChoicesQueryOptions } from '../api/builder-api';
import styles from './Builder.module.css';

export interface CalculatorTableSelectProps {
  readonly calculator: CalculatorDefinition;
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (table: string | undefined) => void;
}

/** Which of the organization's tables (rate tables) the calculator uses here; nothing for a calculator without tables. */
export function CalculatorTableSelect({ calculator, value, disabled = false, onChange }: CalculatorTableSelectProps) {
  const { t } = useTranslation('workflows');
  const choices = useQuery({ ...calculatorChoicesQueryOptions(useApiClient()), enabled: calculator.usesTable === true });
  if (calculator.usesTable !== true) return null;
  if (choices.data === undefined) return choices.isError ? <p className={styles.note}>{t('builder.calculator.tablesFailed')}</p> : null;
  const tables = choices.data.find((entry) => entry.code === calculator.code)?.tables ?? [];
  if (tables.length === 0) return <p className={styles.note}>{t('builder.calculator.noTables')}</p>;
  const known = tables.some((table) => table.code === value);
  return (
    <Select
      label={t('builder.calculator.table')}
      hint={t('builder.calculator.tableHint')}
      disabled={disabled}
      placeholder={t('builder.calculator.tablePlaceholder')}
      options={[...tables.map((table) => ({ value: table.code, label: table.name })), ...(value !== '' && !known ? [{ value, label: t('builder.calculator.tableGone', { code: value }) }] : [])]}
      value={value}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
    />
  );
}

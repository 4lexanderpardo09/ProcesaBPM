import type { SelectHTMLAttributes } from 'react';
import { FieldFrame, type FieldMessages } from '../field/FieldFrame';
import { cx } from '@/shared/lib/cx';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export type SelectProps = FieldMessages &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'required' | 'children'> & {
    readonly options: readonly SelectOption[];
    readonly placeholder?: string;
  };

export function Select({ label, hint, error, required, options, placeholder, className, ...selectProps }: SelectProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required={required}>
      {(control) => (
        <select {...selectProps} {...control} className={cx(control.className, className)}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}

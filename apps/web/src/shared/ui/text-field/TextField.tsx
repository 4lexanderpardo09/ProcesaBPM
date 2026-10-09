import type { InputHTMLAttributes } from 'react';
import { FieldFrame, type FieldMessages } from '../field/FieldFrame';
import { cx } from '@/shared/lib/cx';

export type TextFieldProps = FieldMessages & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'required'>;

export function TextField({ label, hint, error, required, className, ...inputProps }: TextFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required={required}>
      {(control) => <input {...inputProps} {...control} className={cx(control.className, className)} />}
    </FieldFrame>
  );
}

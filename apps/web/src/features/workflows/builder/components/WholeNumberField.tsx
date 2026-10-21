import { useEffect, useState } from 'react';
import { TextField } from '@/shared/ui';
import { parseWhole } from '../lib/numbers';

export interface WholeNumberFieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly value: number | null;
  readonly min?: number;
  readonly max?: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number | null) => void;
}

/** A box for a whole number: what is typed stays as typed ("-" on the way to "-3"); the document gets the number or null. */
export function WholeNumberField({ label, hint, value, min, max, disabled = false, onChange }: WholeNumberFieldProps) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    setText((current) => (parseWhole(current) === value ? current : value === null ? '' : String(value)));
  }, [value]);
  return (
    <TextField
      label={label}
      {...(hint === undefined ? {} : { hint })}
      inputMode="numeric"
      {...(min === undefined ? {} : { min })}
      {...(max === undefined ? {} : { max })}
      disabled={disabled}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parseWhole(event.target.value);
        if (event.target.value.trim() === '' || parsed !== null) onChange(parsed);
      }}
    />
  );
}

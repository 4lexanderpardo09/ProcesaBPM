import { useEffect, useState } from 'react';
import { TextField } from '@/shared/ui';

const parse = (text: string): number | null => {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '' || !/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

/** A box for a number that may have decimals (a comma counts as the point); empty is `null`. */
export function DecimalField({ label, hint, value, onChange }: { readonly label: string; readonly hint?: string; readonly value: number | null; readonly onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    setText((current) => (parse(current) === value ? current : value === null ? '' : String(value)));
  }, [value]);
  return (
    <TextField
      label={label}
      {...(hint === undefined ? {} : { hint })}
      inputMode="decimal"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parse(event.target.value);
        if (event.target.value.trim() === '' || parsed !== null) onChange(parsed);
      }}
    />
  );
}

import { useEffect, useState } from 'react';
import { TextField } from '@/shared/ui';

const split = (text: string) =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

/** Values separated by commas: the text stays as typed ("a, " on the way to "a, b"), the parent gets the list. */
export function ListTextField({ label, hint, values, onChange }: { readonly label: string; readonly hint?: string; readonly values: readonly string[]; readonly onChange: (values: string[]) => void }) {
  const [text, setText] = useState(values.join(', '));
  useEffect(() => {
    setText((current) => (split(current).join('\u0000') === values.join('\u0000') ? current : values.join(', ')));
  }, [values]);
  return (
    <TextField
      label={label}
      {...(hint === undefined ? {} : { hint })}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(split(event.target.value));
      }}
    />
  );
}

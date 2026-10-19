import type { ComponentPropsWithRef } from 'react';
import { FieldFrame, type FieldMessages } from '../field/FieldFrame';
import styles from './TextArea.module.css';
import { cx } from '@/shared/lib/cx';

export type TextAreaProps = FieldMessages & Omit<ComponentPropsWithRef<'textarea'>, 'id' | 'required'>;

/** Several lines of text with the same label, hint and error as TextField. */
export function TextArea({ label, hint, error, required, className, rows = 4, ...textAreaProps }: TextAreaProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error} required={required}>
      {(control) => <textarea rows={rows} {...textAreaProps} {...control} className={cx(control.className, styles.textArea, className)} />}
    </FieldFrame>
  );
}

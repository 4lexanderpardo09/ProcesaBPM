import type { ComponentPropsWithRef } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './Checkbox.module.css';

export type CheckboxProps = Omit<ComponentPropsWithRef<'input'>, 'type'> & { readonly label: string };

export function Checkbox({ label, className, ...inputProps }: CheckboxProps) {
  return (
    <label className={cx(styles.checkbox, className)}>
      <input type="checkbox" className={styles.input} {...inputProps} />
      {label}
    </label>
  );
}

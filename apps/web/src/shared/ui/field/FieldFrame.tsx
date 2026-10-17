import { type ReactNode, useId } from 'react';
import styles from './field.module.css';
import { cx } from '@/shared/lib/cx';

export interface FieldMessages {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly required?: boolean | undefined;
}

export interface FieldControlProps {
  readonly id: string;
  readonly className: string;
  readonly 'aria-invalid': boolean;
  readonly 'aria-describedby': string | undefined;
  readonly required: boolean | undefined;
}

interface FieldFrameProps extends FieldMessages {
  readonly children: (control: FieldControlProps) => ReactNode;
}

/** Label, hint and error around a form control, wired for assistive technology. Shared by TextField and Select. */
export function FieldFrame({ label, hint, error, required, children }: FieldFrameProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = cx(hint !== undefined && hintId, error !== undefined && errorId);

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={cx('text-label', styles.label)}>
        {label}
        {required === true && <span className={styles.required} aria-hidden="true"> *</span>}
      </label>
      {children({
        id,
        className: cx(styles.control),
        'aria-invalid': error !== undefined,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        required,
      })}
      {hint !== undefined && <p id={hintId} className={styles.hint}>{hint}</p>}
      {error !== undefined && <p id={errorId} className={styles.error}>{error}</p>}
    </div>
  );
}

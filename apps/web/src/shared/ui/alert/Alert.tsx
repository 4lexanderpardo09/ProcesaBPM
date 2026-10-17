import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './Alert.module.css';

export type AlertTone = 'danger' | 'warn' | 'info' | 'ok';

export interface AlertProps {
  readonly tone: AlertTone;
  readonly title?: string | undefined;
  readonly children?: ReactNode;
}

/** Errors are announced at once (`role="alert"`); the other tones politely (`role="status"`). */
export function Alert({ tone, title, children }: AlertProps) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx(styles.alert, styles[tone])}>
      {title !== undefined && <p className={styles.title}>{title}</p>}
      {children}
    </div>
  );
}

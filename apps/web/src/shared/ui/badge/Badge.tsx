import type { ReactNode } from 'react';
import styles from './Badge.module.css';
import { cx } from '@/shared/lib/cx';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'violet';

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
}

/** A status is always a word plus a colored dot, never color alone. */
export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span className={cx(styles.badge, styles[tone])}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}

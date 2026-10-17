import type { ReactNode } from 'react';
import styles from './Topbar.module.css';

export interface TopbarProps {
  /** Breadcrumbs or the live status. */
  readonly start?: ReactNode;
  /** The signed-in person and the sign-out action. */
  readonly end?: ReactNode;
}

export function Topbar({ start, end }: TopbarProps) {
  return (
    <header className={styles.topbar}>
      <div className={styles.start}>{start}</div>
      <div className={styles.end}>{end}</div>
    </header>
  );
}

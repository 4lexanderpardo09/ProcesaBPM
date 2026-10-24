import type { ReactNode } from 'react';
import styles from './Topbar.module.css';

export interface TopbarProps {
  /** The button that opens the sidebar on narrow screens. */
  readonly menu?: ReactNode;
  /** Breadcrumbs or the live status. */
  readonly start?: ReactNode;
  /** The signed-in person and the sign-out action. */
  readonly end?: ReactNode;
}

export function Topbar({ menu, start, end }: TopbarProps) {
  return (
    <header className={styles.topbar} data-print="hide">
      {menu}
      <div className={styles.start}>{start}</div>
      <div className={styles.end}>{end}</div>
    </header>
  );
}

import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly actions?: ReactNode;
}

/** Page title with its main action on the right. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.titles}>
        <h1 className="text-page-title">{title}</h1>
        {subtitle !== undefined && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

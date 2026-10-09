import type { ReactNode } from 'react';
import styles from './Card.module.css';
import { cx } from '@/shared/lib/cx';

export interface CardProps {
  readonly title?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

export function Card({ title, actions, children }: CardProps) {
  return (
    <section className={styles.card}>
      {title !== undefined && (
        <header className={styles.header}>
          <h3 className={cx('text-card-title', styles.title)}>{title}</h3>
          {actions}
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  );
}

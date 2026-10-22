import { Link } from 'react-router';
import { cx } from '@/shared/lib/cx';
import styles from './StatTile.module.css';

export interface StatTileProps {
  readonly label: string;
  /** `undefined` while it loads. */
  readonly value: number | undefined;
  /** Colors the number when it is above zero: overdue is danger, due soon is warn. */
  readonly tone?: 'danger' | 'warn';
  /** Where the tickets behind the number are listed. */
  readonly to?: string;
}

/** One counter of the home: the number, what it counts, and a way to the tickets it counts. */
export function StatTile({ label, value, tone, to }: StatTileProps) {
  const body = (
    <>
      <span className={cx(styles.value, value !== undefined && value > 0 && tone !== undefined && styles[tone])}>{value === undefined ? '–' : value.toLocaleString('es-CO')}</span>
      <span className={styles.label}>{label}</span>
    </>
  );
  return to === undefined ? (
    <div className={styles.tile}>{body}</div>
  ) : (
    <Link to={to} className={cx(styles.tile, styles.linked)}>
      {body}
    </Link>
  );
}

import { cx } from '@/shared/lib/cx';
import styles from './Reports.module.css';

export interface BarProps {
  /** The value's share of the longest one, from 0 to 1. */
  readonly share: number;
  /** The value as written next to the bar: the bar never stands alone. */
  readonly label: string;
  /** Status bars (against a target) carry their state in words too, beside the color. */
  readonly tone?: 'ok' | 'warn' | 'danger' | undefined;
  /** Where the target sits, from 0 to 1. */
  readonly target?: number;
}

/** A thin horizontal bar with its value: one series, so it needs no legend. */
export function Bar({ share, label, tone, target }: BarProps) {
  const width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  return (
    <span className={styles.barRow}>
      <span className={styles.barTrack} aria-hidden="true">
        <span className={cx(styles.barFill, tone !== undefined && styles[tone])} style={{ width }} />
        {target !== undefined && <span className={styles.barTarget} style={{ left: `${Math.max(0, Math.min(1, target)) * 100}%` }} />}
      </span>
      <span className={styles.barValue}>{label}</span>
    </span>
  );
}

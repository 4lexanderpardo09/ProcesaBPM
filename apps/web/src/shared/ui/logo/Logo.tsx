import symbolOnDarkUrl from '@design/logos/procesabpm-simbolo.svg';
import symbolUrl from '@design/logos/procesabpm-simbolo-color.svg';
import { cx } from '@/shared/lib/cx';
import styles from './Logo.module.css';

export type LogoTone = 'light' | 'dark';

/**
 * The symbol and the "ProcesaBPM" wordmark, which carries the accessible name.
 * `tone` is the background it sits on: the color symbol goes on light ones, the navy square on dark ones.
 */
export function Logo({ tone = 'light' }: { readonly tone?: LogoTone }) {
  return (
    <span className={cx(styles.logo, tone === 'dark' && styles.onDark)}>
      <img src={tone === 'dark' ? symbolOnDarkUrl : symbolUrl} alt="" className={styles.symbol} />
      <span className={styles.wordmark}>
        Procesa<span className={styles.suffix}>BPM</span>
      </span>
    </span>
  );
}

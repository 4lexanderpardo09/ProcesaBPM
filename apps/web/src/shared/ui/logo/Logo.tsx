import symbolUrl from '@design/logos/procesabpm-simbolo-color.svg';
import styles from './Logo.module.css';

/** The color symbol (for light backgrounds) and the "ProcesaBPM" wordmark, which carries the accessible name. */
export function Logo() {
  return (
    <span className={styles.logo}>
      <img src={symbolUrl} alt="" className={styles.symbol} />
      <span className={styles.wordmark}>
        Procesa<span className={styles.suffix}>BPM</span>
      </span>
    </span>
  );
}

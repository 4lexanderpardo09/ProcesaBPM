import { useTranslation } from 'react-i18next';
import { Logo } from '@/shared/ui';
import styles from './session-pages.module.css';

export function SessionSplash() {
  const { t } = useTranslation('auth');
  return (
    <main className={styles.screen} aria-busy="true">
      <section className={styles.panel}>
        <Logo />
        <p className={styles.splash} role="status">
          {t('session.loading')}
        </p>
      </section>
    </main>
  );
}

import { useTranslation } from 'react-i18next';
import { CheckIcon, Logo } from '@/shared/ui';
import styles from './BrandPanel.module.css';
import { FlowIllustration } from './FlowIllustration';

const highlights = ['workflows', 'sla', 'approvals'] as const;

/** The product pitch beside the sign-in pages; hidden on narrow screens, where the form stands alone. */
export function BrandPanel() {
  const { t } = useTranslation('auth');
  return (
    <aside className={styles.panel}>
      <div className={styles.brand}>
        <Logo tone="dark" />
      </div>
      <div className={styles.inner}>
        <div className={styles.copy}>
          <div className={styles.pitch}>
            <p className={`text-display ${styles.headline}`}>{t('brand.headline')}</p>
            <p className={styles.summary}>{t('brand.summary')}</p>
          </div>
          <ul className={styles.highlights}>
            {highlights.map((key) => (
              <li key={key} className={styles.highlight}>
                <CheckIcon size={16} className={styles.check} />
                {t(`brand.highlights.${key}`)}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.art}>
          <FlowIllustration />
        </div>
      </div>
    </aside>
  );
}

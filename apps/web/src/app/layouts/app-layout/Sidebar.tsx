import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { cx } from '@/shared/lib/cx';
import { Logo } from '@/shared/ui';
import { navigationSections } from './navigation';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const { t } = useTranslation('navigation');

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <Logo />
      </div>
      <nav aria-label={t('mainLabel')} className={styles.nav}>
        {navigationSections.map((section) => {
          const titleId = `nav-section-${section.key}`;
          return (
            <section key={section.key} aria-labelledby={titleId} className={styles.section}>
              <h2 id={titleId} className={cx('text-overline', styles.sectionTitle)}>
                {t(`sections.${section.key}`)}
              </h2>
              <ul className={styles.list}>
                {section.items.map(({ key, path, icon: Icon }) => (
                  <li key={key}>
                    <NavLink to={path} className={cx(styles.link)}>
                      <Icon size={17} />
                      {t(`items.${key}`)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </nav>
    </aside>
  );
}

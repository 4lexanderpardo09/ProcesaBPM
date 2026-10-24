import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { paths } from '@/shared/lib/paths';
import { cx } from '@/shared/lib/cx';
import { usePermissions } from '@/shared/session';
import { Logo } from '@/shared/ui';
import { navigationSections } from './navigation';
import styles from './Sidebar.module.css';

/** `open` matters only on narrow screens, where the sidebar is a drawer. */
export function Sidebar({ open = false }: { readonly open?: boolean }) {
  const { t } = useTranslation('navigation');
  const { canAny } = usePermissions();

  return (
    <aside id="app-sidebar" className={cx(styles.sidebar, open && styles.open)}>
      <div className={styles.brand}>
        <Logo />
      </div>
      <nav aria-label={t('mainLabel')} className={styles.nav}>
        {navigationSections.map((section) => {
          const items = section.items.filter((item) => item.requires === undefined || canAny(item.requires));
          if (items.length === 0) return null;
          const titleId = `nav-section-${section.key}`;
          return (
            <section key={section.key} aria-labelledby={titleId} className={styles.section}>
              <h2 id={titleId} className={cx('text-overline', styles.sectionTitle)}>
                {t(`sections.${section.key}`)}
              </h2>
              <ul className={styles.list}>
                {items.map(({ key, path, icon: Icon }) => (
                  <li key={key}>
                    <NavLink to={path} end={path === paths.home} className={cx(styles.link)}>
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

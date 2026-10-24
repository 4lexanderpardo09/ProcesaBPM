import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';
import { OrganizationSwitcher, UserMenu, useTenantFromLink } from '@/features/auth';
import { NotificationBell } from '@/features/notifications';
import { EndVisitButton, SupportVisitTitle, useSupportVisits } from '@/features/platform';
import { AnnouncementsBanner } from '@/features/settings';
import { MenuIcon } from '@/shared/ui';
import styles from './AppLayout.module.css';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * Sidebar, top bar and the routed page in the scrollable content area. On a narrow screen the sidebar is a drawer the
 * menu button opens; it closes on choosing a page, with Escape or by touching outside it. During a support visit the
 * top bar names the organization as read-only and offers the way out instead of the person's own menus.
 */
export function AppLayout() {
  useTenantFromLink();
  const { t } = useTranslation('navigation');
  const { visit } = useSupportVisits();
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <div className={styles.shell}>
      <Sidebar open={menuOpen} />
      {menuOpen && <div className={styles.backdrop} aria-hidden="true" onClick={() => setMenuOpen(false)} />}
      <div className={styles.main}>
        <Topbar
          menu={
            <button type="button" className={styles.menuButton} aria-label={t('openMenu')} aria-expanded={menuOpen} aria-controls="app-sidebar" onClick={() => setMenuOpen((open) => !open)}>
              <MenuIcon size={20} />
            </button>
          }
          start={visit === null ? <OrganizationSwitcher /> : <SupportVisitTitle visit={visit} />}
          end={
            visit === null ? (
              <>
                <NotificationBell />
                <UserMenu />
              </>
            ) : (
              <EndVisitButton visit={visit} />
            )
          }
        />
        <main className={styles.content}>
          <AnnouncementsBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

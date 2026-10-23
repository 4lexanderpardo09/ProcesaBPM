import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router';
import { loginPath, paths } from '@/shared/lib/paths';
import { Button } from '@/shared/ui';
import { platformQueryKeys } from '../api/platform-api';
import { usePlatformSession, usePlatformSessionState } from '../session/PlatformSessionContext';
import styles from './PlatformLayout.module.css';

const SECTIONS = [
  [paths.platformAnnouncements, 'announcements'],
  [paths.platformPlans, 'plans'],
  [paths.platformAdmins, 'admins'],
  [paths.platformAccounts, 'accounts'],
] as const;

/**
 * The console's frame: only with an open platform session (else back to sign in), ended at the token's expiry, with
 * its own sections and «Salir». What it read is dropped when the session ends.
 */
export function PlatformLayout() {
  const { t } = useTranslation('platform');
  const session = usePlatformSession();
  const state = usePlatformSessionState();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (state === null) {
      queryClient.removeQueries({ queryKey: platformQueryKeys.all });
      return undefined;
    }
    const timer = setTimeout(() => session.end(), Math.max(0, state.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [state, session, queryClient]);

  if (state === null) return <Navigate to={loginPath(undefined, 'expired')} replace />;
  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <span className={styles.brand}>{t('title')}</span>
        <nav aria-label={t('nav.label')} className={styles.nav}>
          <NavLink to={paths.platform} end className={({ isActive }) => (isActive ? styles.active : styles.link)}>
            {t('nav.tenants')}
          </NavLink>
          {SECTIONS.map(([path, key]) => (
            <NavLink key={path} to={path} className={({ isActive }) => (isActive ? styles.active : styles.link)}>
              {t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>
        <Button
          variant="ghost"
          onClick={() => {
            void session.close().then(() => navigate(paths.login, { replace: true }));
          }}
        >
          {t('signOut')}
        </Button>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

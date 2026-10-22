import { Outlet } from 'react-router';
import { OrganizationSwitcher, UserMenu, useTenantFromLink } from '@/features/auth';
import { NotificationBell } from '@/features/notifications';
import { AnnouncementsBanner } from '@/features/settings';
import styles from './AppLayout.module.css';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/** Fixed sidebar, top bar and the routed page in the scrollable content area. */
export function AppLayout() {
  useTenantFromLink();
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <Topbar
          start={<OrganizationSwitcher />}
          end={
            <>
              <NotificationBell />
              <UserMenu />
            </>
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

import { Outlet } from 'react-router';
import { UserMenu } from '@/features/auth';
import styles from './AppLayout.module.css';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/** Fixed sidebar, top bar and the routed page in the scrollable content area. */
export function AppLayout() {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <Topbar end={<UserMenu />} />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

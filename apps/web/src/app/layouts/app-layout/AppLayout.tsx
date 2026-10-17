import { Outlet } from 'react-router';
import styles from './AppLayout.module.css';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/** Fixed sidebar, top bar and the routed page in the scrollable content area. */
export function AppLayout() {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <Topbar />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

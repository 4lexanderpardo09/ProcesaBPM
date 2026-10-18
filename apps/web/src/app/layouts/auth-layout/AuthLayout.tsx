import { Outlet } from 'react-router';
import styles from './AuthLayout.module.css';

/** Centered on the app background, for the pages outside a session. */
export function AuthLayout() {
  return (
    <main className={styles.layout}>
      <Outlet />
    </main>
  );
}

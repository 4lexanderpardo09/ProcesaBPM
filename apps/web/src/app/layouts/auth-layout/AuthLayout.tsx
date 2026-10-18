import { Outlet } from 'react-router';
import styles from './AuthLayout.module.css';
import { BrandPanel } from './BrandPanel';

/** The pages outside a session: the brand panel on the left and the page on the right. */
export function AuthLayout() {
  return (
    <div className={styles.layout}>
      <BrandPanel />
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}

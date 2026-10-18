import type { ReactNode } from 'react';
import { Logo } from '@/shared/ui';
import styles from './AuthPanel.module.css';

/** The column of a sign-in page; it shows the logo only when the brand panel is hidden. */
export function AuthPanel({ children }: { readonly children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <div className={styles.brand}>
        <Logo />
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

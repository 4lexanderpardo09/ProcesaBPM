import type { ReactNode } from 'react';
import { Logo } from '@/shared/ui';
import styles from './AuthCard.module.css';

export function AuthCard({ children }: { readonly children: ReactNode }) {
  return (
    <section className={styles.card}>
      <div className={styles.brand}>
        <Logo />
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

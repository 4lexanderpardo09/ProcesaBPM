import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionManager } from '@/shared/session';
import { Button, Logo } from '@/shared/ui';
import styles from './session-pages.module.css';

export interface SessionScreenProps {
  readonly title: string;
  readonly body?: string;
  readonly children?: ReactNode;
  readonly onRetry?: () => void;
}

/** Full-screen state of the session (unavailable, blocked, pending deletion) with sign-out always at hand. */
export function SessionScreen({ title, body, children, onRetry }: SessionScreenProps) {
  const { t } = useTranslation('auth');
  const manager = useSessionManager();
  return (
    <main className={styles.screen}>
      <section className={styles.panel}>
        <Logo />
        <h1 className="text-page-title">{title}</h1>
        {body !== undefined && <p className={styles.body}>{body}</p>}
        {children}
        <div className={styles.actions}>
          {onRetry !== undefined && (
            <Button variant="primary" onClick={onRetry}>
              {t('session.retry')}
            </Button>
          )}
          <Button onClick={() => void manager.signOut()}>{t('session.signOut')}</Button>
        </div>
      </section>
    </main>
  );
}

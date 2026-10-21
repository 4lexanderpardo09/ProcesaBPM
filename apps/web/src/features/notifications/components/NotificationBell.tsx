import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { paths } from '@/shared/lib/paths';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { BellIcon, Button } from '@/shared/ui';
import { notificationsQueryOptions, unreadCountQueryOptions } from '../api/notifications-api';
import { useMarkRead } from '../hooks/use-mark-read';
import { NotificationList } from './NotificationList';
import styles from './NotificationBell.module.css';

const PANEL_SIZE = 8;
const MAX_SHOWN_COUNT = 9;

/**
 * The bell in the top bar: how many are unread (asked again every minute and when the window gets the focus) and,
 * on click, the newest ones. Escape, a click outside or moving to another page closes it.
 */
export function NotificationBell() {
  const { t } = useTranslation('notifications');
  const client = useApiClient();
  const count = useQuery(unreadCountQueryOptions(client)).data?.count ?? 0;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) !== true) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.bell}
        aria-label={count === 0 ? t('bell.label') : t('bell.labelUnread', { count })}
        title={t('bell.label')}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <BellIcon size={17} />
        {count > 0 && (
          <span className={styles.count} aria-hidden="true">
            {count > MAX_SHOWN_COUNT ? `${MAX_SHOWN_COUNT}+` : count}
          </span>
        )}
      </button>
      {open && <NotificationPanel id={panelId} unread={count} onClose={() => setOpen(false)} />}
    </div>
  );
}

function NotificationPanel({ id, unread, onClose }: { readonly id: string; readonly unread: number; readonly onClose: () => void }) {
  const { t } = useTranslation('notifications');
  const client = useApiClient();
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const latest = useQuery(notificationsQueryOptions(client, { unread: false, page: 1, pageSize: PANEL_SIZE }));
  const markRead = useMarkRead();
  const items = latest.data?.items;

  return (
    <section id={id} className={styles.panel} aria-label={t('title')}>
      <header className={styles.header}>
        <h2 className={styles.heading}>{t('title')}</h2>
        {unread > 0 && (
          <Button variant="ghost" disabled={markRead.all.isPending} onClick={() => markRead.all.mutate()}>
            {t('markAllRead')}
          </Button>
        )}
      </header>
      <div className={styles.content}>
        {items === undefined ? (
          <p className={styles.muted}>{latest.isError ? t('loadFailed') : t('loading')}</p>
        ) : items.length === 0 ? (
          <p className={styles.muted}>{t('empty')}</p>
        ) : (
          <NotificationList
            items={items}
            timeZone={timeZone}
            onOpen={(notification) => {
              if (notification.readAt === null) markRead.one.mutate(notification.id);
              onClose();
            }}
            onMarkRead={(notification) => markRead.one.mutate(notification.id)}
          />
        )}
      </div>
      <footer className={styles.footer}>
        <Link to={paths.notifications} className={styles.all} onClick={onClose}>
          {t('seeAll')}
        </Link>
      </footer>
    </section>
  );
}

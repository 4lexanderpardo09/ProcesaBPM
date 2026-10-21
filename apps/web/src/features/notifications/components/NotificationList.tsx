import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { cx } from '@/shared/lib/cx';
import { ticketPath } from '@/shared/lib/paths';
import type { NotificationItem } from '../api/notifications-api';
import { formatRelativeTime } from '../lib/relative-time';
import styles from './NotificationList.module.css';

export interface NotificationListProps {
  readonly items: readonly NotificationItem[];
  readonly timeZone: string | undefined;
  /** Opening one marks it read; the parent also closes the bell's panel. */
  readonly onOpen: (notification: NotificationItem) => void;
  readonly onMarkRead: (notification: NotificationItem) => void;
  readonly now?: Date;
}

/**
 * Notifications, newest first. One about a ticket is a link to it; an unread one says so in words (not only the dot)
 * and offers to mark it read without opening it.
 */
export function NotificationList({ items, timeZone, onOpen, onMarkRead, now = new Date() }: NotificationListProps) {
  const { t } = useTranslation('notifications');
  return (
    <ul className={styles.list}>
      {items.map((notification) => {
        const unread = notification.readAt === null;
        const text = (
          <>
            <span className={styles.title}>
              {unread && <span className={styles.visuallyHidden}>{t('unreadPrefix')}</span>}
              {unread && ' '}
              {notification.title}
            </span>{' '}
            {notification.body !== '' && <span className={styles.body}>{notification.body}</span>}{' '}
            <time className={styles.time} dateTime={notification.createdAt}>
              {formatRelativeTime(notification.createdAt, now, timeZone)}
            </time>
          </>
        );
        return (
          <li key={notification.id} className={cx(styles.item, unread && styles.unread)}>
            <span className={styles.dot} aria-hidden="true" />
            {notification.ticketId === null ? (
              <span className={styles.text}>{text}</span>
            ) : (
              <Link to={ticketPath(notification.ticketId)} className={cx(styles.text, styles.link)} onClick={() => onOpen(notification)}>
                {text}
              </Link>
            )}
            {unread && (
              <button type="button" className={styles.markRead} aria-label={t('markReadNamed', { title: notification.title })} title={t('markRead')} onClick={() => onMarkRead(notification)}>
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

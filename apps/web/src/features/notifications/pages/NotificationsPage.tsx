import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { genericErrorMessage } from '@/shared/api';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { Alert, Button, Card, PageHeader, Pagination, Tabs } from '@/shared/ui';
import { NOTIFICATIONS_PAGE_SIZE, notificationsQueryOptions, unreadCountQueryOptions } from '../api/notifications-api';
import { NotificationList } from '../components/NotificationList';
import { useMarkRead } from '../hooks/use-mark-read';
import styles from './NotificationsPage.module.css';

const FILTERS = ['all', 'unread'] as const;
type Filter = (typeof FILTERS)[number];

/** Every notification of the person, newest first, all or only the unread ones; the URL keeps the tab and the page. */
export function NotificationsPage() {
  const { t } = useTranslation('notifications');
  const { t: tCommon } = useTranslation();
  const client = useApiClient();
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const [params, setParams] = useSearchParams();
  const filter: Filter = FILTERS.find((value) => value === params.get('filter')) ?? 'all';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const show = (next: { filter: Filter; page: number }) => {
    const query = new URLSearchParams();
    if (next.filter !== 'all') query.set('filter', next.filter);
    if (next.page > 1) query.set('page', String(next.page));
    setParams(query, { replace: true });
  };
  const unread = useQuery(unreadCountQueryOptions(client)).data?.count;
  const list = useQuery({ ...notificationsQueryOptions(client, { unread: filter === 'unread', page, pageSize: NOTIFICATIONS_PAGE_SIZE }), placeholderData: keepPreviousData });
  const markRead = useMarkRead();
  const failure = markRead.all.error ?? markRead.one.error;
  const message = failure === null ? undefined : genericErrorMessage(failure);
  const data = list.data;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={unread === undefined ? undefined : t('unreadCount', { count: unread })}
        actions={
          unread !== undefined && unread > 0 ? (
            <Button disabled={markRead.all.isPending} onClick={() => markRead.all.mutate()}>
              {t('markAllRead')}
            </Button>
          ) : undefined
        }
      />
      <div className={styles.toolbar}>
        <Tabs
          label={t('filtersLabel')}
          items={FILTERS.map((value) => ({ value, label: t(`filters.${value}`), ...(value === 'unread' && unread !== undefined ? { count: unread } : {}) }))}
          value={filter}
          onChange={(value) => show({ filter: value, page: 1 })}
        />
      </div>
      {message !== undefined && <Alert tone="danger">{'values' in message ? tCommon(message.key, message.values) : tCommon(message.key)}</Alert>}
      <Card>
        {data === undefined ? (
          <p className={styles.muted}>{list.isError ? t('loadFailed') : t('loading')}</p>
        ) : data.items.length === 0 ? (
          <p className={styles.muted}>{filter === 'unread' ? t('emptyUnread') : t('empty')}</p>
        ) : (
          <>
            <NotificationList
              items={data.items}
              timeZone={timeZone}
              onOpen={(notification) => {
                if (notification.readAt === null) markRead.one.mutate(notification.id);
              }}
              onMarkRead={(notification) => markRead.one.mutate(notification.id)}
            />
            <div className={styles.pagination}>
              <Pagination page={page} pageSize={NOTIFICATIONS_PAGE_SIZE} total={data.total} onChange={(next) => show({ filter, page: next })} />
            </div>
          </>
        )}
      </Card>
    </>
  );
}

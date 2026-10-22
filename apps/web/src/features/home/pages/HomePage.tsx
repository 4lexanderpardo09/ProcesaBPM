import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { TicketStatusBadge } from '@/features/tickets';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { paths, ticketPath } from '@/shared/lib/paths';
import { useApiClient, useCurrentUser, usePermissions } from '@/shared/session';
import { Badge, ButtonLink, Card, PageHeader, PlusIcon, Table, type TableColumn } from '@/shared/ui';
import { homeStatsQueryOptions, type PendingTicket, pendingTicketsQueryOptions } from '../api/home-api';
import { StatTile } from '../components/StatTile';
import styles from './HomePage.module.css';

/**
 * Where the person lands: their counters (assigned, overdue, due within a day, their open requests, closed this week)
 * and the tickets waiting on them, the most urgent first. Everything is limited to what they may read.
 */
export function HomePage() {
  const { t } = useTranslation('home');
  const client = useApiClient();
  const { can } = usePermissions();
  const me = useCurrentUser().data;
  const stats = useQuery(homeStatsQueryOptions(client));
  const pending = useQuery(pendingTicketsQueryOptions(client));
  const timeZone = me?.user.timeZone ?? undefined;
  const value = (pick: (data: NonNullable<typeof stats.data>) => number) => (stats.data === undefined ? undefined : pick(stats.data));

  const columns: TableColumn<PendingTicket>[] = [
    { key: 'number', header: t('pending.number'), width: '110px', code: true, cell: (row) => row.number },
    {
      key: 'title',
      header: t('pending.title'),
      cell: (row) => (
        <Link to={ticketPath(row.id)} className={styles.link}>
          {row.title}
        </Link>
      ),
    },
    { key: 'status', header: t('pending.status'), width: '120px', cell: (row) => <TicketStatusBadge status={row.status} /> },
    {
      key: 'due',
      header: t('pending.due'),
      width: '230px',
      cell: (row) =>
        row.dueAt === null ? (
          t('pending.noDue')
        ) : (
          <span className={styles.due}>
            {formatDateTime(row.dueAt, timeZone)}
            {row.overdue && <Badge tone="danger">{t('pending.overdue')}</Badge>}
          </span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={me === undefined ? t('title') : t('greeting', { name: me.user.firstName })}
        subtitle={t('subtitle')}
        actions={
          can('create', 'Ticket') || can('create_for_others', 'Ticket') ? (
            <ButtonLink to={paths.newTicket} variant="primary" icon={<PlusIcon size={15} />}>
              {t('newTicket')}
            </ButtonLink>
          ) : undefined
        }
      />
      <section className={styles.tiles} aria-label={t('stats.label')}>
        <StatTile label={t('stats.myOpen')} value={value((data) => data.myOpen)} to={paths.tickets} />
        <StatTile label={t('stats.myOverdue')} value={value((data) => data.myOverdue)} tone="danger" to={paths.tickets} />
        <StatTile label={t('stats.myDueSoon')} value={value((data) => data.myDueSoon)} tone="warn" to={paths.tickets} />
        <StatTile label={t('stats.createdByMeOpen')} value={value((data) => data.createdByMeOpen)} to={`${paths.tickets}?view=created&status=OPEN`} />
        <StatTile label={t('stats.closedByMeWeek')} value={value((data) => data.closedByMeWeek)} />
      </section>
      {stats.isError && <p className={styles.note}>{t('loadFailed')}</p>}
      <Card title={t('pending.heading')}>
        <Table
          label={t('pending.heading')}
          columns={columns}
          rows={pending.data ?? []}
          rowKey={(row) => row.id}
          loading={pending.data === undefined && !pending.isError}
          loadingLabel={t('loading')}
          empty={pending.isError ? t('loadFailed') : t('pending.empty')}
        />
      </Card>
    </>
  );
}

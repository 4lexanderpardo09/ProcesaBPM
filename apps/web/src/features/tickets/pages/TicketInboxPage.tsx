import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { paths } from '@/shared/lib/paths';
import { useCurrentUser } from '@/shared/session';
import { ButtonLink, PageHeader, Pagination, PlusIcon, Tabs } from '@/shared/ui';
import { INBOX_PAGE_SIZE } from '../api/tickets-api';
import { InboxFilters } from '../components/InboxFilters';
import { LoadError } from '../components/LoadError';
import { TicketTable } from '../components/TicketTable';
import { useTicketInbox } from '../hooks/use-ticket-inbox';
import { filtersOf, hasFilters, INBOX_VIEWS, type InboxParams, readInboxParams, writeInboxParams } from '../lib/inbox-params';
import styles from './TicketInboxPage.module.css';

/** The tickets of the person in tabs (assigned, created, observed, all) with how many each holds, filtered and paginated; the URL keeps it all. */
export function TicketInboxPage() {
  const { t } = useTranslation('tickets');
  const [searchParams, setSearchParams] = useSearchParams();
  const params = readInboxParams(searchParams);
  const { list, countOf } = useTicketInbox(params);
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const show = (next: Partial<InboxParams>) => setSearchParams(writeInboxParams({ ...params, page: 1, ...next }));
  const page = list.data;

  return (
    <>
      <PageHeader
        title={t('inbox.title')}
        subtitle={page === undefined ? undefined : t('inbox.count', { count: page.total })}
        actions={
          <ButtonLink to={paths.newTicket} variant="primary" icon={<PlusIcon size={15} />}>
            {t('inbox.newTicket')}
          </ButtonLink>
        }
      />
      <div className={styles.toolbar}>
        <Tabs
          label={t('inbox.viewsLabel')}
          items={INBOX_VIEWS.map((view) => ({ value: view, label: t(`views.${view}`), ...countProp(countOf(view)) }))}
          value={params.view}
          onChange={(view) => show({ view })}
        />
        <InboxFilters filters={filtersOf(params)} onChange={(filters) => show(filters)} />
      </div>
      {list.isError ? (
        <LoadError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <TicketTable
          tickets={page?.items ?? []}
          loading={page === undefined}
          empty={hasFilters(filtersOf(params)) ? t('inbox.empty.filtered') : t(`inbox.empty.${params.view}`)}
          timeZone={timeZone}
          footer={page === undefined || page.total === 0 ? undefined : <Pagination page={params.page} pageSize={INBOX_PAGE_SIZE} total={page.total} onChange={(next) => show({ page: next })} />}
        />
      )}
    </>
  );
}

function countProp(count: number | undefined): { count?: number } {
  return count === undefined ? {} : { count };
}

import type { AuditLogEntry } from '@procesabpm/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { Button, Card, Table, type TableColumn, TextField } from '@/shared/ui';
import { type AuditFilters, fetchAuditPage, settingsQueryKeys } from '../api/settings-api';
import { actionLabel } from '../lib/audit-actions';
import styles from './Settings.module.css';

const ACTION = /^[a-z][a-z_]*(\.[a-z_]*)?$/;
const NO_FILTERS: AuditFilters = { from: '', to: '', action: '' };

/**
 * Who did what in the organization: changes of roles, people, catalog, workflows, security and support visits, newest
 * first (by default the last 30 days). Each entry opens to show what it changed.
 */
export function AuditTab() {
  const { t } = useTranslation('settings');
  const client = useApiClient();
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const [draft, setDraft] = useState<AuditFilters>(NO_FILTERS);
  const [filters, setFilters] = useState<AuditFilters>(NO_FILTERS);
  const [open, setOpen] = useState<string>();
  const log = useInfiniteQuery({
    queryKey: settingsQueryKeys.audit(filters),
    queryFn: ({ pageParam, signal }) => fetchAuditPage(client, filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const entries = log.data?.pages.flatMap((page) => page.items) ?? [];
  const actionError = draft.action !== '' && !ACTION.test(draft.action) ? t('audit.actionInvalid') : undefined;

  const columns: TableColumn<AuditLogEntry>[] = [
    { key: 'at', header: t('audit.at'), width: '190px', cell: (row) => formatDateTime(row.at, timeZone) },
    { key: 'actor', header: t('audit.actor'), cell: (row) => row.actor?.name ?? (row.supportGrantId !== null ? t('audit.support') : t('audit.system')) },
    { key: 'action', header: t('audit.action'), cell: (row) => actionLabel(row.action, t) },
    { key: 'subject', header: t('audit.subject'), cell: (row) => row.subjectType },
    {
      key: 'detail',
      header: t('audit.detail'),
      width: '110px',
      cell: (row) => (
        <Button variant="ghost" aria-expanded={open === row.id} aria-label={t('audit.detailOf', { action: actionLabel(row.action, t) })} onClick={() => setOpen(open === row.id ? undefined : row.id)}>
          {open === row.id ? t('audit.hide') : t('audit.show')}
        </Button>
      ),
    },
  ];
  const opened = entries.find((entry) => entry.id === open);

  return (
    <Card title={t('audit.title')}>
      <div className={styles.stack}>
        <form
          className={styles.filters}
          onSubmit={(event) => {
            event.preventDefault();
            if (actionError === undefined) setFilters({ ...draft, action: draft.action.trim() });
          }}
        >
          <TextField label={t('audit.from')} type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
          <TextField label={t('audit.to')} type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
          <TextField label={t('audit.actionFilter')} hint={t('audit.actionHint')} error={actionError} value={draft.action} onChange={(event) => setDraft({ ...draft, action: event.target.value.trim() })} />
          <Button type="submit">{t('audit.apply')}</Button>
        </form>
        <p className={styles.note}>{filters.from === '' && filters.to === '' ? t('audit.defaultRange') : t('audit.customRange')}</p>
        <Table
          label={t('audit.title')}
          columns={columns}
          rows={entries}
          rowKey={(row) => row.id}
          loading={log.data === undefined && !log.isError}
          loadingLabel={t('loading')}
          empty={log.isError ? t('loadFailed') : t('audit.empty')}
        />
        {opened !== undefined && (
          <section className={styles.detail} aria-label={t('audit.detailOf', { action: actionLabel(opened.action, t) })}>
            <p className={styles.note}>{t('audit.meta', { ip: opened.ipAddress ?? '—', request: opened.requestId ?? '—' })}</p>
            <div className={styles.diff}>
              <div>
                <h3 className={styles.small}>{t('audit.before')}</h3>
                <pre>{opened.before === null || opened.before === undefined ? '—' : JSON.stringify(opened.before, null, 2)}</pre>
              </div>
              <div>
                <h3 className={styles.small}>{t('audit.after')}</h3>
                <pre>{opened.after === null || opened.after === undefined ? '—' : JSON.stringify(opened.after, null, 2)}</pre>
              </div>
            </div>
          </section>
        )}
        {log.hasNextPage && (
          <div>
            <Button disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
              {log.isFetchingNextPage ? t('loading') : t('audit.more')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

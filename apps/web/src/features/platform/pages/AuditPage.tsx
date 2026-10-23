import type { ListPlatformAuditQuery, PlatformAuditEntryResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { PageHeader, Pagination, Table, TextField } from '@/shared/ui';
import { auditQueryOptions } from '../api/platform-api';
import { PlatformError } from '../components/PlatformError';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

/** The platform's audit (5 years): who did what to which organization, filtered by action and dates. */
export function AuditPage() {
  const { t } = useTranslation('platform');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebouncedValue(action.trim(), 300);
  const filters: Partial<ListPlatformAuditQuery> = {
    page,
    ...(term === '' ? {} : { action: term }),
    ...(from === '' ? {} : { from: new Date(`${from}T00:00:00`).toISOString() }),
    ...(to === '' ? {} : { to: new Date(`${to}T23:59:59.999`).toISOString() }),
  };
  const entries = useQuery(auditQueryOptions(usePlatformClient(), filters));
  const reset = () => setPage(1);
  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />
      <div className={styles.filters}>
        <TextField
          label={t('audit.action')}
          hint={t('audit.actionHint')}
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            reset();
          }}
        />
        <TextField
          label={t('audit.from')}
          type="date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            reset();
          }}
        />
        <TextField
          label={t('audit.to')}
          type="date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            reset();
          }}
        />
      </div>
      {entries.isError && <PlatformError error={entries.error} onRetry={() => void entries.refetch()} />}
      <Table<PlatformAuditEntryResponse>
        label={t('audit.title')}
        rows={entries.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={entries.data === undefined && !entries.isError}
        loadingLabel={t('loading')}
        empty={t('audit.empty')}
        columns={[
          { key: 'at', header: t('audit.columns.at'), width: '170px', cell: (row) => formatDateTime(row.createdAt) },
          { key: 'action', header: t('audit.columns.action'), code: true, cell: (row) => row.action },
          { key: 'actor', header: t('audit.columns.actor'), code: true, cell: (row) => row.actorUserId ?? t('audit.system') },
          { key: 'tenant', header: t('audit.columns.tenant'), code: true, cell: (row) => row.targetTenantId ?? '—' },
          { key: 'ip', header: t('audit.columns.ip'), width: '130px', cell: (row) => row.ipAddress ?? '—' },
        ]}
      />
      {entries.data !== undefined && <Pagination page={entries.data.page} pageSize={entries.data.pageSize} total={entries.data.total} onChange={setPage} />}
    </>
  );
}

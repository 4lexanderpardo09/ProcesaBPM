import { type FailedOutboxEvent, TENANT_STATUSES } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Button, Card, PageHeader, Pagination, Table, Tabs } from '@/shared/ui';
import { failedEventsQueryOptions, metricsQueryOptions, platformQueryKeys, retryEvent } from '../api/platform-api';
import { PlatformError } from '../components/PlatformError';
import { formatStorage } from '../lib/storage-units';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

type Scope = FailedOutboxEvent['scope'];
type TenantStatus = (typeof TENANT_STATUSES)[number];
const STATUS_KEYS: ReadonlySet<string> = new Set(TENANT_STATUSES);

/** How the platform is doing (organizations, people, storage, tickets a day) and the background events that failed for good, to send again. */
export function OperationsPage() {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const metrics = useQuery(metricsQueryOptions(client));
  const [scope, setScope] = useState<Scope>('TENANT');
  const [page, setPage] = useState(1);
  const failed = useQuery(failedEventsQueryOptions(client, scope, page));
  const retry = useMutation({ mutationFn: (event: FailedOutboxEvent) => retryEvent(client, event), onSuccess: () => queryClient.invalidateQueries({ queryKey: platformQueryKeys.all }) });
  const data = metrics.data;
  const lastWeek = data?.ticketsPerDay.slice(-7) ?? [];
  return (
    <>
      <PageHeader title={t('operations.title')} subtitle={t('operations.subtitle')} />
      <div className={styles.stack}>
        {metrics.isError && <PlatformError error={metrics.error} onRetry={() => void metrics.refetch()} />}
        {data !== undefined && (
          <Card title={t('operations.metrics')}>
            <dl className={styles.facts}>
              {Object.entries(data.tenantsByStatus).map(([status, count]) => (
                <div key={status}>
                  <dt>{t('operations.tenantsIn', { status: STATUS_KEYS.has(status) ? t(`statuses.${status as TenantStatus}`) : status })}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
              <div>
                <dt>{t('operations.users')}</dt>
                <dd>{t('operations.usersText', { total: data.users.total, active: data.users.withActiveMembership })}</dd>
              </div>
              <div>
                <dt>{t('operations.storage')}</dt>
                <dd>{formatStorage(data.storageUsedBytes)}</dd>
              </div>
              <div>
                <dt>{t('operations.ticketsWeek')}</dt>
                <dd>{lastWeek.reduce((sum, day) => sum + day.count, 0)}</dd>
              </div>
            </dl>
          </Card>
        )}
        <Card title={t('operations.failed')}>
          <div className={styles.stack}>
            <Tabs<Scope>
              label={t('operations.failed')}
              items={(['TENANT', 'PLATFORM'] as const).map((value) => ({ value, label: t(`operations.scopes.${value}`) }))}
              value={scope}
              onChange={(value) => {
                setScope(value);
                setPage(1);
              }}
            />
            {failed.isError && <PlatformError error={failed.error} onRetry={() => void failed.refetch()} />}
            <Table<FailedOutboxEvent>
              label={t('operations.failed')}
              rows={failed.data?.items ?? []}
              rowKey={(row) => row.id}
              loading={failed.data === undefined && !failed.isError}
              loadingLabel={t('loading')}
              empty={t('operations.noFailed')}
              columns={[
                { key: 'type', header: t('operations.columns.type'), code: true, cell: (row) => row.type },
                { key: 'attempts', header: t('operations.columns.attempts'), width: '90px', cell: (row) => String(row.attempts) },
                { key: 'error', header: t('operations.columns.error'), cell: (row) => row.lastError ?? '—' },
                { key: 'created', header: t('operations.columns.createdAt'), width: '170px', cell: (row) => formatDateTime(row.createdAt) },
                {
                  key: 'retry',
                  header: '',
                  width: '110px',
                  cell: (row) => (
                    <Button variant="ghost" disabled={retry.isPending} aria-label={t('operations.retryNamed', { type: row.type })} onClick={() => retry.mutate(row)}>
                      {t('operations.retry')}
                    </Button>
                  ),
                },
              ]}
            />
            {failed.data !== undefined && <Pagination page={failed.data.page} pageSize={failed.data.pageSize} total={failed.data.total} onChange={setPage} />}
            {retry.isError && <PlatformError error={retry.error} />}
          </div>
        </Card>
      </div>
    </>
  );
}

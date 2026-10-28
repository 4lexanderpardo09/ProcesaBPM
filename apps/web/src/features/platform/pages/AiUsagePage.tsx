import type { TenantAiUsage } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { platformTenantPath } from '@/shared/lib/paths';
import { Badge, Card, PageHeader, Select, Table, type TableColumn } from '@/shared/ui';
import { aiUsageQueryOptions } from '../api/platform-api';
import { PlatformError } from '../components/PlatformError';
import { recentUsageMonths, usageMonthLabel } from '../lib/usage-months';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

type SortKey = 'name' | 'jobs' | 'calls' | 'total';
type Direction = 'asc' | 'desc';

const number = new Intl.NumberFormat('es-CO');
const SORT_VALUE: Readonly<Record<Exclude<SortKey, 'name'>, (row: TenantAiUsage) => number>> = {
  jobs: (row) => row.jobs.total,
  calls: (row) => row.calls,
  total: (row) => row.totalTokens,
};

function sortRows(rows: readonly TenantAiUsage[], key: SortKey, direction: Direction): TenantAiUsage[] {
  const sign = direction === 'asc' ? 1 : -1;
  const compare = key === 'name' ? (a: TenantAiUsage, b: TenantAiUsage) => a.name.localeCompare(b.name, 'es') : (a: TenantAiUsage, b: TenantAiUsage) => SORT_VALUE[key](a) - SORT_VALUE[key](b);
  return [...rows].sort((a, b) => sign * compare(a, b));
}

/** A new column starts with the names A–Z and the biggest figures first; the same column flips. */
function nextDirection(current: { key: SortKey; direction: Direction }, key: SortKey): Direction {
  if (current.key === key) return current.direction === 'asc' ? 'desc' : 'asc';
  return key === 'name' ? 'asc' : 'desc';
}

/** What the AI assistant cost per organization in a month, in tokens, with the platform's total. */
export function AiUsagePage() {
  const { t } = useTranslation('platform');
  const navigate = useNavigate();
  const months = useMemo(() => recentUsageMonths(new Date()), []);
  const [month, setMonth] = useState(months[0]!);
  const [sort, setSort] = useState<{ key: SortKey; direction: Direction }>({ key: 'total', direction: 'desc' });
  const usage = useQuery(aiUsageQueryOptions(usePlatformClient(), month.from, month.to));
  const rows = useMemo(() => sortRows(usage.data?.tenants ?? [], sort.key, sort.direction), [usage.data, sort]);
  const totals = usage.data?.totals;

  const sortable = (key: SortKey): NonNullable<TableColumn<TenantAiUsage>['sort']> => ({
    direction: sort.key === key ? sort.direction : undefined,
    onSort: () => setSort((current) => ({ key, direction: nextDirection(current, key) })),
  });

  return (
    <>
      <PageHeader title={t('aiUsage.title')} subtitle={t('aiUsage.subtitle')} />
      <div className={styles.stack}>
        <div className={styles.filters}>
          <Select
            label={t('aiUsage.month')}
            value={month.value}
            options={months.map((option) => ({ value: option.value, label: usageMonthLabel(option) }))}
            onChange={(event) => setMonth(months.find((option) => option.value === event.target.value) ?? months[0]!)}
          />
        </div>
        {usage.isError && <PlatformError error={usage.error} onRetry={() => void usage.refetch()} />}
        {totals !== undefined && (
          <Card title={t('aiUsage.totals')}>
            <dl className={styles.facts}>
              <div>
                <dt>{t('aiUsage.jobs')}</dt>
                <dd>{t('aiUsage.jobsText', { total: number.format(totals.jobs.total), succeeded: number.format(totals.jobs.succeeded), failed: number.format(totals.jobs.failed) })}</dd>
              </div>
              <div>
                <dt>{t('aiUsage.calls')}</dt>
                <dd>{number.format(totals.calls)}</dd>
              </div>
              <div>
                <dt>{t('aiUsage.promptTokens')}</dt>
                <dd>{t('aiUsage.promptText', { tokens: number.format(totals.promptTokens), cached: number.format(totals.cachedPromptTokens) })}</dd>
              </div>
              <div>
                <dt>{t('aiUsage.completionTokens')}</dt>
                <dd>{t('aiUsage.completionText', { tokens: number.format(totals.completionTokens), reasoning: number.format(totals.reasoningTokens) })}</dd>
              </div>
              <div>
                <dt>{t('aiUsage.totalTokens')}</dt>
                <dd>{number.format(totals.totalTokens)}</dd>
              </div>
            </dl>
          </Card>
        )}
        <Card title={t('aiUsage.perTenant')}>
          <div className={styles.stack}>
            <Table<TenantAiUsage>
              label={t('aiUsage.perTenant')}
              rows={rows}
              rowKey={(row) => row.tenantId}
              loading={usage.data === undefined && !usage.isError}
              loadingLabel={t('loading')}
              empty={t('aiUsage.empty')}
              onRowClick={(row) => void navigate(platformTenantPath(row.tenantId))}
              columns={[
                { key: 'name', header: t('aiUsage.columns.tenant'), sort: sortable('name'), cell: (row) => row.name },
                {
                  key: 'assistant',
                  header: t('aiUsage.columns.assistant'),
                  width: '120px',
                  cell: (row) => <Badge tone={row.assistantEnabled ? 'ok' : 'neutral'}>{row.assistantEnabled ? t('aiUsage.enabled') : t('aiUsage.disabled')}</Badge>,
                },
                { key: 'jobs', header: t('aiUsage.columns.jobs'), width: '120px', code: true, sort: sortable('jobs'), cell: (row) => number.format(row.jobs.total) },
                { key: 'failed', header: t('aiUsage.columns.failed'), width: '100px', code: true, cell: (row) => number.format(row.jobs.failed) },
                { key: 'calls', header: t('aiUsage.columns.calls'), width: '110px', code: true, sort: sortable('calls'), cell: (row) => number.format(row.calls) },
                { key: 'prompt', header: t('aiUsage.columns.prompt'), width: '120px', code: true, cell: (row) => number.format(row.promptTokens) },
                { key: 'completion', header: t('aiUsage.columns.completion'), width: '120px', code: true, cell: (row) => number.format(row.completionTokens) },
                { key: 'total', header: t('aiUsage.columns.total'), width: '130px', code: true, sort: sortable('total'), cell: (row) => number.format(row.totalTokens) },
              ]}
            />
            <p className={styles.note}>{t('aiUsage.note')}</p>
          </div>
        </Card>
      </div>
    </>
  );
}

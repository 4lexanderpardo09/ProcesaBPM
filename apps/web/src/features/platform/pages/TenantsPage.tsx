import { TENANT_STATUSES, type TenantListItem } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { formatShortDate } from '@/shared/lib/format-date-time';
import { platformTenantPath } from '@/shared/lib/paths';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { Button, PageHeader, Pagination, PlusIcon, Select, Table, TextField } from '@/shared/ui';
import { plansQueryOptions, tenantsQueryOptions } from '../api/platform-api';
import { CreateTenantDialog } from '../components/CreateTenantDialog';
import { PlatformError } from '../components/PlatformError';
import { TenantStatusBadge } from '../components/TenantStatusBadge';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

type Status = TenantListItem['status'];

/** The platform's organizations, searched and filtered by status and plan, each one opening its detail. */
export function TenantsPage() {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const [planCode, setPlanCode] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const term = useDebouncedValue(search.trim(), 300);
  const tenants = useQuery(tenantsQueryOptions(client, { page, ...(term === '' ? {} : { search: term }), ...(status === '' ? {} : { status }), ...(planCode === '' ? {} : { planCode }) }));
  const plans = useQuery(plansQueryOptions(client));

  return (
    <>
      <PageHeader
        title={t('tenants.title')}
        subtitle={t('tenants.subtitle')}
        actions={
          <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setCreating(true)}>
            {t('tenants.new')}
          </Button>
        }
      />
      <div className={styles.filters}>
        <TextField
          label={t('tenants.search')}
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <Select
          label={t('tenants.status')}
          placeholder={t('tenants.anyStatus')}
          options={TENANT_STATUSES.map((value) => ({ value, label: t(`statuses.${value}`) }))}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as Status | '');
            setPage(1);
          }}
        />
        <Select
          label={t('tenants.plan')}
          placeholder={t('tenants.anyPlan')}
          options={(plans.data ?? []).map((plan) => ({ value: plan.code, label: plan.name }))}
          value={planCode}
          onChange={(event) => {
            setPlanCode(event.target.value);
            setPage(1);
          }}
        />
      </div>
      {tenants.isError && <PlatformError error={tenants.error} onRetry={() => void tenants.refetch()} />}
      <Table<TenantListItem>
        label={t('tenants.tableLabel')}
        rows={tenants.data?.items ?? []}
        rowKey={(row) => row.tenantId}
        loading={tenants.data === undefined && !tenants.isError}
        loadingLabel={t('loading')}
        empty={t('tenants.empty')}
        onRowClick={(row) => void navigate(platformTenantPath(row.tenantId))}
        columns={[
          { key: 'name', header: t('tenants.columns.name'), cell: (row) => row.name },
          { key: 'slug', header: t('tenants.columns.slug'), code: true, cell: (row) => row.slug },
          { key: 'plan', header: t('tenants.columns.plan'), cell: (row) => plans.data?.find((plan) => plan.code === row.planCode)?.name ?? row.planCode },
          { key: 'country', header: t('tenants.columns.country'), width: '80px', cell: (row) => row.countryCode },
          { key: 'status', header: t('tenants.columns.status'), width: '130px', cell: (row) => <TenantStatusBadge status={row.status} /> },
          { key: 'created', header: t('tenants.columns.createdAt'), width: '120px', cell: (row) => formatShortDate(row.createdAt) },
        ]}
      />
      {tenants.data !== undefined && <Pagination page={tenants.data.page} pageSize={tenants.data.pageSize} total={tenants.data.total} onChange={setPage} />}
      {creating && <CreateTenantDialog onClose={() => setCreating(false)} onCreated={(tenantId) => void navigate(platformTenantPath(tenantId))} />}
    </>
  );
}

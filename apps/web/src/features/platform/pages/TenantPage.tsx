import type { TenantDetail } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { formatFileSize } from '@/shared/lib/format-file-size';
import { formatDateTime, formatShortDate } from '@/shared/lib/format-date-time';
import { paths } from '@/shared/lib/paths';
import { Alert, Breadcrumb, Button, Card, Dialog, PageHeader, Select, TextArea } from '@/shared/ui';
import { changeTenantPlan, plansQueryOptions, platformQueryKeys, reactivateTenant, suspendTenant, tenantQueryOptions } from '../api/platform-api';
import { PlatformError } from '../components/PlatformError';
import { TenantStatusBadge } from '../components/TenantStatusBadge';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

const GIGABYTE = 1024 ** 3;
/** Storage reads in GB from one up (the plans count in gigabytes); below, as a file size. */
const bytes = (text: string) => {
  const value = Number(text);
  return value >= GIGABYTE ? new Intl.NumberFormat('es-CO', { style: 'unit', unit: 'gigabyte', unitDisplay: 'short', maximumFractionDigits: 1 }).format(value / GIGABYTE) : formatFileSize(value);
};

/** One organization: what it uses (aggregates only), its state and what the platform can do with it. */
export function TenantPage() {
  const { tenantId = '' } = useParams();
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const tenant = useQuery(tenantQueryOptions(client, tenantId));
  const breadcrumb = <Breadcrumb label={t('title')} items={[{ label: t('tenant.back'), to: paths.platform }, { label: tenant.data?.name ?? '…' }]} />;

  if (tenant.isError) {
    return (
      <>
        {breadcrumb}
        <PlatformError error={tenant.error} onRetry={() => void tenant.refetch()} />
      </>
    );
  }
  const data = tenant.data;
  if (data === undefined) return <p className={styles.note}>{t('loading')}</p>;
  return (
    <>
      {breadcrumb}
      <PageHeader title={data.name} subtitle={data.slug} actions={<TenantStatusBadge status={data.status} />} />
      <div className={styles.stack}>
        {data.suspension !== null && <Alert tone="warn">{t('tenant.suspendedSince', { date: formatDateTime(data.suspension.at), reason: data.suspension.reason })}</Alert>}
        {data.deletion !== null && <Alert tone="danger">{t('tenant.deletion', { date: formatShortDate(data.deletion.requestedAt), purge: data.deletion.purgeAfter === null ? '—' : formatShortDate(data.deletion.purgeAfter) })}</Alert>}
        <Card title={t('tenant.facts')}>
          <dl className={styles.facts}>
            <Fact label={t('tenant.plan')} value={data.plan.name} />
            <Fact label={t('tenant.country')} value={data.countryCode} />
            <Fact label={t('tenant.createdAt')} value={formatShortDate(data.createdAt)} />
            <Fact label={t('tenant.owner')} value={data.owner === null ? t('tenant.noOwner') : `${data.owner.firstName} ${data.owner.lastName} · ${data.owner.email}`} />
            <Fact label={t('tenant.companies')} value={String(data.companies)} />
            <Fact label={t('tenant.activeUsers')} value={String(data.activeUsers)} />
            <Fact label={t('tenant.tickets30')} value={String(data.ticketsLast30Days)} />
            <Fact label={t('tenant.lastActivity')} value={data.lastActivityAt === null ? t('tenant.never') : formatDateTime(data.lastActivityAt)} />
            <Fact label={t('tenant.storage')} value={`${t('tenant.storageUsed', { used: bytes(data.storage.usedBytes), limit: bytes(data.storage.limitBytes) })} · ${t(`tenant.storageStates.${data.storage.state}`)}`} />
          </dl>
        </Card>
        <TenantActions tenant={data} />
      </div>
    </>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Change the plan, and suspend or reactivate with a reason (both go to the platform's audit). */
function TenantActions({ tenant }: { readonly tenant: TenantDetail }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const plans = useQuery(plansQueryOptions(client));
  const [planCode, setPlanCode] = useState(tenant.planCode);
  const [asking, setAsking] = useState<'suspend' | 'reactivate'>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: platformQueryKeys.all });
  const plan = useMutation({
    mutationFn: () => changeTenantPlan(client, tenant.tenantId, planCode),
    onSuccess: (detail) => {
      queryClient.setQueryData(platformQueryKeys.tenant(tenant.tenantId), detail);
      void refresh();
    },
  });
  const editable = tenant.status === 'ACTIVE' || tenant.status === 'SUSPENDED';
  return (
    <Card title={t('tenant.actions')}>
      <div className={styles.stack}>
        <div className={styles.actions}>
          <Select
            label={t('tenant.changePlan')}
            disabled={!editable}
            options={(plans.data ?? []).filter((candidate) => candidate.isActive || candidate.code === tenant.planCode).map((candidate) => ({ value: candidate.code, label: candidate.name }))}
            value={planCode}
            onChange={(event) => setPlanCode(event.target.value)}
          />
          <Button disabled={!editable || planCode === tenant.planCode || plan.isPending} onClick={() => plan.mutate()}>
            {plan.isPending ? t('saving') : t('save')}
          </Button>
          {tenant.status === 'ACTIVE' && (
            <Button variant="secondary" onClick={() => setAsking('suspend')}>
              {t('tenant.suspend')}
            </Button>
          )}
          {tenant.status === 'SUSPENDED' && (
            <Button variant="primary" onClick={() => setAsking('reactivate')}>
              {t('tenant.reactivate')}
            </Button>
          )}
        </div>
        {plan.isSuccess && <Alert tone="ok">{t('tenant.planChanged')}</Alert>}
        {plan.isError && <PlatformError error={plan.error} />}
      </div>
      {asking !== undefined && <StatusDialog tenant={tenant} action={asking} onClose={() => setAsking(undefined)} onDone={() => void refresh()} />}
    </Card>
  );
}

const MIN_REASON = 3;

/** Suspending asks why (3 characters at least); reactivating may say why. */
function StatusDialog({ tenant, action, onClose, onDone }: { readonly tenant: TenantDetail; readonly action: 'suspend' | 'reactivate'; readonly onClose: () => void; readonly onDone: () => void }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const text = reason.trim();
  const tooShort = action === 'suspend' ? text.length < MIN_REASON : text !== '' && text.length < MIN_REASON;
  const run = useMutation({
    mutationFn: () => (action === 'suspend' ? suspendTenant(client, tenant.tenantId, text) : reactivateTenant(client, tenant.tenantId, text === '' ? undefined : text)),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Dialog
      open
      title={t(action === 'suspend' ? 'tenant.suspendTitle' : 'tenant.reactivateTitle', { name: tenant.name })}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (!tooShort && !run.isPending) run.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={run.isPending}>
            {t(action === 'suspend' ? 'tenant.suspend' : 'tenant.reactivate')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        {action === 'suspend' && <p className={styles.note}>{t('tenant.suspendHint')}</p>}
        <TextArea
          label={action === 'suspend' ? t('tenant.reason') : t('tenant.reasonOptional')}
          required={action === 'suspend'}
          maxLength={500}
          error={submitted && tooShort ? t('tenant.reasonShort') : undefined}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {run.isError && <PlatformError error={run.error} />}
      </div>
    </Dialog>
  );
}

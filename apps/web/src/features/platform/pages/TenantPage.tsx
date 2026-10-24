import type { TenantDetail } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { formatDateTime, formatShortDate } from '@/shared/lib/format-date-time';
import { paths } from '@/shared/lib/paths';
import { Alert, Breadcrumb, Button, Card, Dialog, PageHeader, Select, TextArea, TextField } from '@/shared/ui';
import { cancelDeletion, changeTenantPlan, plansQueryOptions, platformQueryKeys, reactivateTenant, requestDeletion, suspendTenant, tenantQueryOptions } from '../api/platform-api';
import { PlatformError } from '../components/PlatformError';
import { formatStorage } from '../lib/storage-units';
import { TenantStatusBadge } from '../components/TenantStatusBadge';
import { usePlatformClient } from '../session/PlatformSessionContext';
import { SupportVisitCard } from '../visit/SupportVisitCard';
import styles from './Platform.module.css';

const bytes = (text: string) => formatStorage(text);

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
        <SupportVisitCard tenant={data} />
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
  const [deleting, setDeleting] = useState(false);
  const cancel = useMutation({ mutationFn: () => cancelDeletion(client, tenant.tenantId), onSuccess: () => refresh() });
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
          {editable && <Button onClick={() => setDeleting(true)}>{t('tenant.delete')}</Button>}
          {tenant.status === 'PENDING_DELETION' && (
            <Button disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              {t('tenant.cancelDeletion')}
            </Button>
          )}
        </div>
        {cancel.isError && <PlatformError error={cancel.error} />}
        {plan.isSuccess && <Alert tone="ok">{t('tenant.planChanged')}</Alert>}
        {plan.isError && <PlatformError error={plan.error} />}
      </div>
      {deleting && <DeletionDialog tenant={tenant} onClose={() => setDeleting(false)} onDone={() => void refresh()} />}
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

/**
 * Asking to delete an organization: its name typed again and a reason. Nobody can enter while it waits; it is purged
 * after 30 days unless the deletion is cancelled.
 */
function DeletionDialog({ tenant, onClose, onDone }: { readonly tenant: TenantDetail; readonly onClose: () => void; readonly onDone: () => void }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const nameOk = name.trim() === tenant.name;
  const reasonOk = reason.trim().length >= MIN_REASON;
  const run = useMutation({
    mutationFn: () => requestDeletion(client, tenant.tenantId, { confirmName: name.trim(), reason: reason.trim() }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Dialog
      open
      title={t('tenant.deleteTitle', { name: tenant.name })}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (nameOk && reasonOk && !run.isPending) run.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={run.isPending}>
            {t('tenant.delete')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <Alert tone="danger">{t('tenant.deleteHint')}</Alert>
        <TextField label={t('tenant.confirmName', { name: tenant.name })} required error={submitted && !nameOk ? t('tenant.nameMismatch') : undefined} value={name} onChange={(event) => setName(event.target.value)} />
        <TextArea label={t('tenant.reason')} required maxLength={500} error={submitted && !reasonOk ? t('tenant.reasonShort') : undefined} value={reason} onChange={(event) => setReason(event.target.value)} />
        {run.isError && <PlatformError error={run.error} />}
      </div>
    </Dialog>
  );
}

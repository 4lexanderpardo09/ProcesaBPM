import type { PlanSummary } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Dialog, PageHeader, Table, TextField } from '@/shared/ui';
import { plansQueryOptions, platformQueryKeys, updatePlan } from '../api/platform-api';
import { PlatformError } from '../components/PlatformError';
import { amountOf, bytesOf, formatStorage, GIGABYTE, MEGABYTE } from '../lib/storage-units';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

/** The plans' limits (prices live outside the platform): storage, its grace and how many users. */
export function PlansPage() {
  const { t } = useTranslation('platform');
  const plans = useQuery(plansQueryOptions(usePlatformClient()));
  const [editing, setEditing] = useState<PlanSummary>();
  return (
    <>
      <PageHeader title={t('plans.title')} subtitle={t('plans.subtitle')} />
      {plans.isError && <PlatformError error={plans.error} onRetry={() => void plans.refetch()} />}
      <Table<PlanSummary>
        label={t('plans.title')}
        rows={plans.data ?? []}
        rowKey={(row) => row.code}
        loading={plans.data === undefined && !plans.isError}
        loadingLabel={t('loading')}
        empty={t('plans.empty')}
        columns={[
          { key: 'name', header: t('plans.columns.name'), cell: (row) => row.name },
          { key: 'code', header: t('plans.columns.code'), code: true, cell: (row) => row.code },
          { key: 'storage', header: t('plans.columns.storage'), cell: (row) => t('plans.storageText', { base: formatStorage(row.storageBaseBytes), perUser: formatStorage(row.storagePerUserBytes) }) },
          { key: 'grace', header: t('plans.columns.grace'), width: '90px', cell: (row) => `${String(row.storageGracePercent)} %` },
          { key: 'users', header: t('plans.columns.maxUsers'), width: '110px', cell: (row) => (row.maxUsers === null ? t('plans.unlimited') : String(row.maxUsers)) },
          { key: 'tenants', header: t('plans.columns.tenants'), width: '120px', cell: (row) => String(row.tenants) },
          { key: 'active', header: t('plans.columns.active'), width: '100px', cell: (row) => (row.isActive ? <Badge tone="ok">{t('plans.active')}</Badge> : <Badge>{t('plans.inactive')}</Badge>) },
          {
            key: 'edit',
            header: '',
            width: '90px',
            cell: (row) => (
              <Button variant="ghost" aria-label={t('plans.edit', { name: row.name })} onClick={() => setEditing(row)}>
                {t('plans.editShort')}
              </Button>
            ),
          },
        ]}
      />
      {editing !== undefined && <PlanDialog plan={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}

/** A plan's limits, in GB and MB; only what changed is sent. */
function PlanDialog({ plan, onClose }: { readonly plan: PlanSummary; readonly onClose: () => void }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(plan.name);
  const [base, setBase] = useState(amountOf(plan.storageBaseBytes, GIGABYTE));
  const [perUser, setPerUser] = useState(amountOf(plan.storagePerUserBytes, MEGABYTE));
  const [grace, setGrace] = useState(String(plan.storageGracePercent));
  const [maxUsers, setMaxUsers] = useState(plan.maxUsers === null ? '' : String(plan.maxUsers));
  const [submitted, setSubmitted] = useState(false);
  const baseBytes = bytesOf(base, GIGABYTE);
  const perUserBytes = bytesOf(perUser, MEGABYTE);
  const gracePercent = /^\d{1,3}$/.test(grace.trim()) && Number(grace) <= 100 ? Number(grace) : undefined;
  const users = maxUsers.trim() === '' ? null : /^\d+$/.test(maxUsers.trim()) && Number(maxUsers) >= 1 ? Number(maxUsers) : undefined;
  const valid = name.trim() !== '' && baseBytes !== undefined && perUserBytes !== undefined && gracePercent !== undefined && users !== undefined;
  const save = useMutation({
    mutationFn: () =>
      updatePlan(client, plan.code, {
        ...(name.trim() === plan.name ? {} : { name: name.trim() }),
        ...(baseBytes === plan.storageBaseBytes ? {} : { storageBaseBytes: baseBytes! }),
        ...(perUserBytes === plan.storagePerUserBytes ? {} : { storagePerUserBytes: perUserBytes! }),
        ...(gracePercent === plan.storageGracePercent ? {} : { storageGracePercent: gracePercent! }),
        ...(users === plan.maxUsers ? {} : { maxUsers: users! }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformQueryKeys.plans() });
      onClose();
    },
  });
  const unchanged = valid && name.trim() === plan.name && baseBytes === plan.storageBaseBytes && perUserBytes === plan.storagePerUserBytes && gracePercent === plan.storageGracePercent && users === plan.maxUsers;
  const bad = (ok: boolean) => (submitted && !ok ? t('plans.form.invalid') : undefined);
  return (
    <Dialog
      open
      title={t('plans.form.title', { name: plan.name })}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (unchanged) onClose();
        else if (valid && !save.isPending) save.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <TextField label={t('plans.form.name')} required maxLength={100} error={bad(name.trim() !== '')} value={name} onChange={(event) => setName(event.target.value)} />
        <TextField label={t('plans.form.base')} inputMode="decimal" error={bad(baseBytes !== undefined)} value={base} onChange={(event) => setBase(event.target.value)} />
        <TextField label={t('plans.form.perUser')} inputMode="decimal" error={bad(perUserBytes !== undefined)} value={perUser} onChange={(event) => setPerUser(event.target.value)} />
        <TextField label={t('plans.form.grace')} inputMode="numeric" error={bad(gracePercent !== undefined)} value={grace} onChange={(event) => setGrace(event.target.value)} />
        <TextField label={t('plans.form.maxUsers')} hint={t('plans.form.maxUsersHint')} inputMode="numeric" error={bad(users !== undefined)} value={maxUsers} onChange={(event) => setMaxUsers(event.target.value)} />
        {save.isError && <PlatformError error={save.error} />}
      </div>
    </Dialog>
  );
}

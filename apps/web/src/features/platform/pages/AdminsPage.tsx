import type { PlatformAdminSummary } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Badge, Button, Dialog, PageHeader, PlusIcon, Table, TextField } from '@/shared/ui';
import { adminsQueryOptions, inviteAdmin, platformQueryKeys, revokeAdmin } from '../api/platform-api';
import { PlatformError } from '../components/PlatformError';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

/** Who administers the platform: invited by e-mail (they set their password and their MFA), and removed here. */
export function AdminsPage() {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const admins = useQuery(adminsQueryOptions(client));
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<PlatformAdminSummary>();
  const revoke = useMutation({
    mutationFn: (userId: string) => revokeAdmin(client, userId),
    onSuccess: async () => {
      setRemoving(undefined);
      await queryClient.invalidateQueries({ queryKey: platformQueryKeys.admins() });
    },
  });
  return (
    <>
      <PageHeader
        title={t('admins.title')}
        subtitle={t('admins.subtitle')}
        actions={
          <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setInviting(true)}>
            {t('admins.invite')}
          </Button>
        }
      />
      {admins.isError && <PlatformError error={admins.error} onRetry={() => void admins.refetch()} />}
      <Table<PlatformAdminSummary>
        label={t('admins.title')}
        rows={admins.data ?? []}
        rowKey={(row) => row.userId}
        loading={admins.data === undefined && !admins.isError}
        loadingLabel={t('loading')}
        empty={t('admins.empty')}
        columns={[
          { key: 'name', header: t('admins.columns.name'), cell: (row) => `${row.firstName} ${row.lastName}` },
          { key: 'email', header: t('admins.columns.email'), cell: (row) => row.email },
          { key: 'status', header: t('admins.columns.status'), width: '120px', cell: (row) => <Badge tone={row.status === 'ACTIVE' ? 'ok' : 'warn'}>{t(`accountStatuses.${row.status}`)}</Badge> },
          { key: 'mfa', header: t('admins.columns.mfa'), width: '90px', cell: (row) => (row.mfaEnabled ? t('yes') : t('no')) },
          { key: 'last', header: t('admins.columns.lastLogin'), cell: (row) => (row.lastLoginAt === null ? t('tenant.never') : formatDateTime(row.lastLoginAt)) },
          {
            key: 'remove',
            header: '',
            width: '100px',
            cell: (row) => (
              <Button variant="ghost" aria-label={t('admins.remove', { name: `${row.firstName} ${row.lastName}` })} onClick={() => setRemoving(row)}>
                {t('admins.removeShort')}
              </Button>
            ),
          },
        ]}
      />
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      {removing !== undefined && (
        <Dialog
          open
          title={t('admins.removeTitle')}
          closeLabel={t('close')}
          onClose={() => setRemoving(undefined)}
          footer={
            <>
              <Button onClick={() => setRemoving(undefined)}>{t('cancel')}</Button>
              <Button variant="primary" disabled={revoke.isPending} onClick={() => revoke.mutate(removing.userId)}>
                {t('admins.removeShort')}
              </Button>
            </>
          }
        >
          <p className={styles.note}>{t('admins.removeConfirm', { name: `${removing.firstName} ${removing.lastName}` })}</p>
          {revoke.isError && <PlatformError error={revoke.error} />}
        </Dialog>
      )}
    </>
  );
}

function InviteDialog({ onClose }: { readonly onClose: () => void }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '' });
  const [submitted, setSubmitted] = useState(false);
  const invite = useMutation({
    mutationFn: () => inviteAdmin(client, { email: form.email.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformQueryKeys.admins() });
      onClose();
    },
  });
  const missing = (value: string) => (submitted && value.trim() === '' ? t('create.required') : undefined);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Dialog
      open
      title={t('admins.invite')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (Object.values(form).every((value) => value.trim() !== '') && !invite.isPending) invite.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={invite.isPending}>
            {t('admins.send')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <p className={styles.note}>{t('admins.inviteHint')}</p>
        <TextField label={t('create.email')} type="email" required maxLength={254} error={missing(form.email)} value={form.email} onChange={(event) => set('email', event.target.value)} />
        <TextField label={t('create.firstName')} required maxLength={100} error={missing(form.firstName)} value={form.firstName} onChange={(event) => set('firstName', event.target.value)} />
        <TextField label={t('create.lastName')} required maxLength={100} error={missing(form.lastName)} value={form.lastName} onChange={(event) => set('lastName', event.target.value)} />
        {invite.isError && <PlatformError error={invite.error} />}
      </div>
    </Dialog>
  );
}

import { SUPPORT_ACCESS_DEFAULT_HOURS, SUPPORT_ACCESS_MAX_HOURS } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { Badge, Button, Card, Table, type TableColumn, TextArea, TextField } from '@/shared/ui';
import { grantSupportAccess, revokeSupportAccess, settingsQueryKeys, type SupportGrant, supportAccessQueryOptions } from '../api/settings-api';
import { SettingsError } from './SettingsError';
import styles from './Settings.module.css';

const STATUS_TONE = { ACTIVE: 'ok', EXPIRED: 'neutral', REVOKED: 'warn' } as const;

/**
 * Lets the platform's support team read the organization for a while (read-only), with a reason; every visit and
 * request they make is listed and audited. The access can be ended at any time.
 */
export function SupportAccessTab() {
  const { t } = useTranslation('settings');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const access = useQuery(supportAccessQueryOptions(client));
  const [hoursText, setHoursText] = useState(String(SUPPORT_ACCESS_DEFAULT_HOURS));
  const hours = /^\d{1,3}$/.test(hoursText.trim()) ? Number(hoursText.trim()) : null;
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const remember = (saved: Awaited<ReturnType<typeof grantSupportAccess>>) => queryClient.setQueryData(settingsQueryKeys.support, saved);
  const grant = useMutation({
    mutationFn: () => grantSupportAccess(client, { hours: hours ?? SUPPORT_ACCESS_DEFAULT_HOURS, reason: reason.trim() }),
    onSuccess: (saved) => {
      remember(saved);
      setReason('');
      setSubmitted(false);
    },
  });
  const revoke = useMutation({ mutationFn: () => revokeSupportAccess(client), onSuccess: remember });
  const active = access.data?.active ?? null;
  const reasonError = submitted && reason.trim().length < 3 ? t('support.reasonRequired') : undefined;
  const hoursError = submitted && (hours === null || hours < 1 || hours > SUPPORT_ACCESS_MAX_HOURS) ? t('support.hoursRange', { max: SUPPORT_ACCESS_MAX_HOURS }) : undefined;

  const columns: TableColumn<SupportGrant>[] = [
    { key: 'status', header: t('support.status'), width: '110px', cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{t(`support.statuses.${row.status}`)}</Badge> },
    { key: 'reason', header: t('support.reason'), cell: (row) => row.reason },
    { key: 'grantedBy', header: t('support.grantedBy'), cell: (row) => row.grantedBy.name },
    { key: 'period', header: t('support.period'), cell: (row) => t('support.range', { from: formatDateTime(row.startsAt, timeZone), to: formatDateTime(row.revokedAt ?? row.expiresAt, timeZone) }) },
    { key: 'use', header: t('support.use'), width: '150px', cell: (row) => t('support.useValue', { visits: row.visits.length, requests: row.requests }) },
  ];

  return (
    <div className={styles.stack}>
      <Card title={t('support.title')}>
        <div className={styles.stack}>
          <p className={styles.note}>{t('support.hint')}</p>
          {access.data === undefined ? (
            <p className={styles.note}>{access.isError ? t('loadFailed') : t('loading')}</p>
          ) : active !== null ? (
            <div className={styles.stack}>
              <p className={styles.strong}>{t('support.activeUntil', { date: formatDateTime(active.expiresAt, timeZone) })}</p>
              <p className={styles.note}>{t('support.activeReason', { reason: active.reason, name: active.grantedBy.name })}</p>
              {active.visits.length > 0 && (
                <ul className={styles.list} aria-label={t('support.visits')}>
                  {active.visits.map((visit) => (
                    <li key={visit.id}>{t('support.visit', { name: visit.administrator, from: formatDateTime(visit.openedAt, timeZone) })}</li>
                  ))}
                </ul>
              )}
              <div>
                <Button disabled={revoke.isPending} onClick={() => revoke.mutate()}>
                  {revoke.isPending ? t('saving') : t('support.revoke')}
                </Button>
              </div>
            </div>
          ) : (
            <form
              className={styles.stack}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitted(true);
                if (reason.trim().length >= 3 && hours !== null && hours >= 1 && hours <= SUPPORT_ACCESS_MAX_HOURS && !grant.isPending) grant.mutate();
              }}
            >
              <TextField label={t('support.hours')} hint={t('support.hoursHint', { max: SUPPORT_ACCESS_MAX_HOURS })} inputMode="numeric" error={hoursError} value={hoursText} onChange={(event) => setHoursText(event.target.value)} />
              <TextArea label={t('support.reason')} required rows={2} maxLength={500} error={reasonError} value={reason} onChange={(event) => setReason(event.target.value)} />
              <div>
                <Button type="submit" variant="brand" disabled={grant.isPending}>
                  {grant.isPending ? t('saving') : t('support.grant')}
                </Button>
              </div>
            </form>
          )}
          <SettingsError error={grant.error ?? revoke.error} />
        </div>
      </Card>
      {access.data !== undefined && access.data.history.length > 0 && (
        <Card title={t('support.history')}>
          <Table label={t('support.history')} columns={columns} rows={access.data.history} rowKey={(row) => row.id} empty={t('support.noHistory')} />
        </Card>
      )}
    </div>
  );
}

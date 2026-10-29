import { EMAIL_SUPPRESSION_REASONS, type EmailSuppressionReason, type EmailSuppressionSummary } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatShortDate } from '@/shared/lib/format-date-time';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { Badge, Button, Dialog, PageHeader, Pagination, Select, Table, TextField } from '@/shared/ui';
import { emailSuppressionsQueryOptions, platformQueryKeys, removeEmailSuppression } from '../api/platform-api';
import { PlatformError } from '../components/PlatformError';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

/** The addresses SES reported as permanent bounces or complaints (the worker no longer writes to them), and removing one. */
export function EmailSuppressionsPage() {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState<EmailSuppressionReason | ''>('');
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<EmailSuppressionSummary>();
  const term = useDebouncedValue(search.trim(), 300);
  const suppressions = useQuery(emailSuppressionsQueryOptions(client, { page, ...(term === '' ? {} : { search: term }), ...(reason === '' ? {} : { reason }) }));
  const remove = useMutation({
    mutationFn: (id: string) => removeEmailSuppression(client, id),
    onSuccess: async () => {
      setRemoving(undefined);
      await queryClient.invalidateQueries({ queryKey: [...platformQueryKeys.all, 'email-suppressions'] });
    },
  });

  return (
    <>
      <PageHeader title={t('emailSuppressions.title')} subtitle={t('emailSuppressions.subtitle')} />
      <div className={styles.filters}>
        <TextField
          label={t('emailSuppressions.search')}
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <Select
          label={t('emailSuppressions.reason')}
          placeholder={t('emailSuppressions.anyReason')}
          options={EMAIL_SUPPRESSION_REASONS.map((value) => ({ value, label: t(`emailSuppressions.reasons.${value}`) }))}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value as EmailSuppressionReason | '');
            setPage(1);
          }}
        />
      </div>
      {suppressions.isError && <PlatformError error={suppressions.error} onRetry={() => void suppressions.refetch()} />}
      <Table<EmailSuppressionSummary>
        label={t('emailSuppressions.tableLabel')}
        rows={suppressions.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={suppressions.data === undefined && !suppressions.isError}
        loadingLabel={t('loading')}
        empty={t('emailSuppressions.empty')}
        columns={[
          { key: 'email', header: t('emailSuppressions.columns.email'), cell: (row) => row.email },
          {
            key: 'reason',
            header: t('emailSuppressions.columns.reason'),
            width: '200px',
            cell: (row) => <Badge tone={row.reason === 'COMPLAINT' ? 'danger' : 'warn'}>{t(`emailSuppressions.reasons.${row.reason}`)}</Badge>,
          },
          { key: 'detail', header: t('emailSuppressions.columns.detail'), code: true, cell: (row) => row.detail ?? '—' },
          { key: 'events', header: t('emailSuppressions.columns.events'), width: '80px', cell: (row) => String(row.events) },
          { key: 'last', header: t('emailSuppressions.columns.lastEventAt'), width: '170px', cell: (row) => formatDateTime(row.lastEventAt) },
          { key: 'created', header: t('emailSuppressions.columns.createdAt'), width: '110px', cell: (row) => formatShortDate(row.createdAt) },
          {
            key: 'remove',
            header: '',
            width: '100px',
            cell: (row) => (
              <Button variant="ghost" aria-label={t('emailSuppressions.remove', { email: row.email })} onClick={() => setRemoving(row)}>
                {t('emailSuppressions.removeShort')}
              </Button>
            ),
          },
        ]}
      />
      {suppressions.data !== undefined && <Pagination page={suppressions.data.page} pageSize={suppressions.data.pageSize} total={suppressions.data.total} onChange={setPage} />}
      {removing !== undefined && (
        <Dialog
          open
          title={t('emailSuppressions.removeTitle')}
          closeLabel={t('close')}
          onClose={() => setRemoving(undefined)}
          footer={
            <>
              <Button onClick={() => setRemoving(undefined)}>{t('cancel')}</Button>
              <Button variant="primary" disabled={remove.isPending} onClick={() => remove.mutate(removing.id)}>
                {t('emailSuppressions.removeShort')}
              </Button>
            </>
          }
        >
          <p className={styles.note}>{t('emailSuppressions.removeConfirm', { email: removing.email })}</p>
          {remove.isError && <PlatformError error={remove.error} />}
        </Dialog>
      )}
    </>
  );
}

import { DEMO_REQUEST_STATUSES, type DemoRequestStatus, type DemoRequestSummary, type ListDemoRequestsQuery, type MarkDemoRequest } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Badge, Button, Dialog, PageHeader, Pagination, Select, Table, TextField } from '@/shared/ui';
import { demoRequestsQueryOptions, markDemoRequest, platformQueryKeys } from '../api/platform-api';
import { PlatformError } from '../components/PlatformError';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

const STATUS_TONE: Readonly<Record<DemoRequestStatus, 'accent' | 'ok' | 'neutral'>> = { NEW: 'accent', CONTACTED: 'ok', DISCARDED: 'neutral' };

/** The website's demo requests: filtered by status and by when they arrived, each one opened to answer or discard it. */
export function DemoRequestsPage() {
  const { t } = useTranslation('platform');
  const [status, setStatus] = useState<DemoRequestStatus | ''>('NEW');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string>();
  const filters: Partial<ListDemoRequestsQuery> = {
    page,
    ...(status === '' ? {} : { status }),
    ...(from === '' ? {} : { from: new Date(`${from}T00:00:00`).toISOString() }),
    ...(to === '' ? {} : { to: new Date(`${to}T23:59:59.999`).toISOString() }),
  };
  const requests = useQuery(demoRequestsQueryOptions(usePlatformClient(), filters));
  const opened = requests.data?.items.find((item) => item.id === openId);
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader title={t('demoRequests.title')} subtitle={t('demoRequests.subtitle')} />
      <div className={styles.filters}>
        <Select
          label={t('demoRequests.status')}
          placeholder={t('demoRequests.anyStatus')}
          options={DEMO_REQUEST_STATUSES.map((value) => ({ value, label: t(`demoRequests.statuses.${value}`) }))}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as DemoRequestStatus | '');
            reset();
          }}
        />
        <TextField
          label={t('demoRequests.from')}
          type="date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            reset();
          }}
        />
        <TextField
          label={t('demoRequests.to')}
          type="date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            reset();
          }}
        />
      </div>
      {requests.isError && <PlatformError error={requests.error} onRetry={() => void requests.refetch()} />}
      <Table<DemoRequestSummary>
        label={t('demoRequests.tableLabel')}
        rows={requests.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={requests.data === undefined && !requests.isError}
        loadingLabel={t('loading')}
        empty={t('demoRequests.empty')}
        onRowClick={(row) => setOpenId(row.id)}
        columns={[
          { key: 'at', header: t('demoRequests.columns.receivedAt'), width: '170px', cell: (row) => formatDateTime(row.createdAt) },
          {
            key: 'name',
            header: t('demoRequests.columns.name'),
            cell: (row) => (
              <button type="button" className={styles.linkButton} aria-label={t('demoRequests.open', { name: row.fullName })} onClick={() => setOpenId(row.id)}>
                {row.fullName}
              </button>
            ),
          },
          { key: 'company', header: t('demoRequests.columns.company'), cell: (row) => row.company },
          { key: 'email', header: t('demoRequests.columns.email'), cell: (row) => row.email },
          { key: 'team', header: t('demoRequests.columns.teamSize'), width: '120px', cell: (row) => t(`demoRequests.teamSizes.${row.teamSize}`) },
          { key: 'status', header: t('demoRequests.columns.status'), width: '120px', cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{t(`demoRequests.statuses.${row.status}`)}</Badge> },
        ]}
      />
      {requests.data !== undefined && <Pagination page={requests.data.page} pageSize={requests.data.pageSize} total={requests.data.total} onChange={setPage} />}
      {opened !== undefined && <DemoRequestDialog request={opened} onClose={() => setOpenId(undefined)} />}
    </>
  );
}

function DemoRequestDialog({ request, onClose }: { readonly request: DemoRequestSummary; readonly onClose: () => void }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const mark = useMutation({
    mutationFn: (body: MarkDemoRequest) => markDemoRequest(client, request.id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...platformQueryKeys.all, 'demo-requests'] });
      onClose();
    },
  });
  const statusText = t(`demoRequests.statuses.${request.status}`);
  return (
    <Dialog
      open
      title={`${request.fullName} · ${request.company}`}
      closeLabel={t('close')}
      onClose={onClose}
      footer={
        <>
          <a className={styles.mailLink} href={`mailto:${request.email}`}>
            {t('demoRequests.detail.write')}
          </a>
          {request.status !== 'DISCARDED' && (
            <Button disabled={mark.isPending} onClick={() => mark.mutate({ status: 'DISCARDED' })}>
              {t('demoRequests.detail.markDiscarded')}
            </Button>
          )}
          {request.status !== 'CONTACTED' && (
            <Button variant="primary" disabled={mark.isPending} onClick={() => mark.mutate({ status: 'CONTACTED' })}>
              {t('demoRequests.detail.markContacted')}
            </Button>
          )}
        </>
      }
    >
      <dl className={styles.facts}>
        <div>
          <dt>{t('demoRequests.columns.status')}</dt>
          <dd>
            <Badge tone={STATUS_TONE[request.status]}>{statusText}</Badge>
          </dd>
        </div>
        <div>
          <dt>{t('demoRequests.detail.receivedAt')}</dt>
          <dd>{formatDateTime(request.createdAt)}</dd>
        </div>
        <div>
          <dt>{t('demoRequests.detail.email')}</dt>
          <dd>{request.email}</dd>
        </div>
        <div>
          <dt>{t('demoRequests.detail.teamSize')}</dt>
          <dd>{t(`demoRequests.teamSizes.${request.teamSize}`)}</dd>
        </div>
        <div>
          <dt>{t('demoRequests.detail.process')}</dt>
          <dd className={styles.preWrap}>{request.process ?? t('demoRequests.detail.noProcess')}</dd>
        </div>
        <div>
          <dt>{t('demoRequests.detail.handled')}</dt>
          <dd>
            {request.handledAt === null
              ? t('demoRequests.detail.notHandled')
              : request.handledBy === null
                ? t('demoRequests.detail.handledByGone', { status: statusText, at: formatDateTime(request.handledAt) })
                : t('demoRequests.detail.handledBy', { status: statusText, name: request.handledBy, at: formatDateTime(request.handledAt) })}
          </dd>
        </div>
      </dl>
      {mark.isError && <PlatformError error={mark.error} />}
    </Dialog>
  );
}

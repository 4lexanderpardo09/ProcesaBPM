import { DATA_EXPORT_STATUSES } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { formatFileSize } from '@/shared/lib/format-file-size';
import { openDownload } from '@/shared/lib/open-download';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { Badge, Button, Card, Checkbox, Table, type TableColumn, TextField } from '@/shared/ui';
import { SettingsError } from './SettingsError';
import styles from './Settings.module.css';

const exportSchema = z.object({
  id: z.string(),
  status: z.enum(DATA_EXPORT_STATUSES),
  includeFiles: z.boolean(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  errorCode: z.string().nullable(),
  downloadCount: z.number().int(),
});
type DataExport = z.infer<typeof exportSchema>;
const EXPORTS_KEY = ['data-exports'] as const;
/** While one is being built, the list is asked again this often. */
const POLL_MS = 15_000;

const listExports = (client: HttpClient, signal: AbortSignal) => client.request('/data-exports', { schema: z.object({ items: z.array(exportSchema) }), signal });

const TONE = { PENDING: 'neutral', RUNNING: 'accent', READY: 'ok', FAILED: 'danger', EXPIRED: 'neutral' } as const;

/**
 * A copy of all the organization's data while it is being deleted (owner or administrators). The password is asked
 * again to start one and to download it; it is built in the background and announced by e-mail.
 */
export function DataExportPanel() {
  const { t } = useTranslation('settings');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const exports = useQuery({
    queryKey: EXPORTS_KEY,
    queryFn: ({ signal }) => listExports(client, signal),
    select: (response) => response.items,
    refetchInterval: (query) => ((query.state.data?.items ?? []).some((item) => item.status === 'PENDING' || item.status === 'RUNNING') ? POLL_MS : false),
  });
  const [password, setPassword] = useState('');
  const [includeFiles, setIncludeFiles] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const request = useMutation({
    mutationFn: () => client.request('/data-exports', { method: 'POST', body: { currentPassword: password, includeFiles } }),
    onSuccess: async () => {
      setPassword('');
      setSubmitted(false);
      await queryClient.invalidateQueries({ queryKey: EXPORTS_KEY });
    },
  });
  const download = useMutation({
    mutationFn: (exportId: string) => client.request(`/data-exports/${encodeURIComponent(exportId)}/download-url`, { method: 'POST', body: { currentPassword: password }, schema: z.object({ url: z.string() }) }),
    onSuccess: ({ url }) => {
      setPassword('');
      openDownload(url);
    },
  });
  const passwordError = submitted && password === '' ? t('exports.passwordRequired') : undefined;

  const columns: TableColumn<DataExport>[] = [
    { key: 'createdAt', header: t('exports.requested'), cell: (row) => formatDateTime(row.createdAt, timeZone) },
    { key: 'status', header: t('exports.status'), width: '130px', cell: (row) => <Badge tone={TONE[row.status]}>{t(`exports.statuses.${row.status}`)}</Badge> },
    { key: 'files', header: t('exports.files'), width: '110px', cell: (row) => (row.includeFiles ? t('exports.withFiles') : t('exports.withoutFiles')) },
    { key: 'size', header: t('exports.size'), width: '110px', cell: (row) => (row.sizeBytes === null ? '—' : formatFileSize(row.sizeBytes)) },
    { key: 'expires', header: t('exports.expires'), cell: (row) => (row.status === 'FAILED' ? t(row.errorCode === 'EXPORT_TOO_LARGE' ? 'exports.tooLarge' : 'exports.failed') : row.expiresAt === null ? '—' : formatDateTime(row.expiresAt, timeZone)) },
    {
      key: 'download',
      header: t('exports.download'),
      width: '140px',
      cell: (row) =>
        row.status === 'READY' ? (
          <Button
            variant="ghost"
            disabled={download.isPending}
            onClick={() => {
              setSubmitted(true);
              if (password !== '') download.mutate(row.id);
            }}
          >
            {t('exports.downloadAction')}
          </Button>
        ) : null,
    },
  ];

  return (
    <Card title={t('exports.title')}>
      <div className={styles.stack}>
        <p className={styles.note}>{t('exports.hint')}</p>
        <TextField label={t('exports.password')} hint={t('exports.passwordHint')} type="password" autoComplete="current-password" error={passwordError} value={password} onChange={(event) => setPassword(event.target.value)} />
        <Checkbox label={t('exports.includeFiles')} checked={includeFiles} onChange={(event) => setIncludeFiles(event.target.checked)} />
        <div>
          <Button
            variant="brand"
            disabled={request.isPending}
            onClick={() => {
              setSubmitted(true);
              if (password !== '') request.mutate();
            }}
          >
            {request.isPending ? t('saving') : t('exports.request')}
          </Button>
        </div>
        <SettingsError error={request.error ?? download.error} />
        <Table label={t('exports.title')} columns={columns} rows={exports.data ?? []} rowKey={(row) => row.id} loading={exports.data === undefined && !exports.isError} loadingLabel={t('loading')} empty={exports.isError ? t('loadFailed') : t('exports.empty')} />
      </div>
    </Card>
  );
}

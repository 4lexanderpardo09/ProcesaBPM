import type { ExportCutoffResponse } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { openDownload } from '@/shared/lib/open-download';
import { cutoffBatchPath } from '@/shared/lib/paths';
import { useApiClient, useCurrentUser, usePermissions } from '@/shared/session';
import { Alert, Badge, Button, ButtonLink, Table, type TableColumn } from '@/shared/ui';
import { WorkflowError } from '../../components/WorkflowError';
import { cutoffDownloadUrl, exportCutoffsQueryOptions, exportQueryKeys, generateCutoff } from '../api/exports-api';
import styles from './Exports.module.css';

const dayMonthYear = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** Opens a file's short-lived link; the browser downloads it. */
export function useCutoffDownload(mine = false) {
  const client = useApiClient();
  return useMutation({
    mutationFn: (cutoffId: string) => cutoffDownloadUrl(client, cutoffId, mine),
    onSuccess: ({ url }) => openDownload(url),
  });
}

/** The files an export made, newest first, and "generate now" for whoever may run a cutoff by hand. */
export function ExportFilesTab({ exportId }: { readonly exportId: string }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const canGenerate = usePermissions().can('generate', 'Export');
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const cutoffs = useQuery(exportCutoffsQueryOptions(client, exportId));
  const download = useCutoffDownload();
  const generate = useMutation({ mutationFn: () => generateCutoff(client, exportId), onSuccess: () => queryClient.invalidateQueries({ queryKey: exportQueryKeys.detail(exportId) }) });
  const columns: TableColumn<ExportCutoffResponse>[] = [
    { key: 'date', header: t('exports.files.date'), width: '110px', cell: (row) => dayMonthYear(row.cutoffDate) },
    { key: 'generatedAt', header: t('exports.files.generatedAt'), width: '170px', cell: (row) => formatDateTime(row.generatedAt, timeZone) },
    { key: 'group', header: t('exports.files.group'), cell: (row) => row.groupLabel ?? '—' },
    { key: 'lines', header: t('exports.files.lines'), width: '80px', cell: (row) => row.lineCount.toLocaleString('es-CO') },
    { key: 'kind', header: t('exports.files.kind'), width: '120px', cell: (row) => <Badge tone={row.isManual ? 'accent' : 'neutral'}>{row.isManual ? t('exports.files.manual') : t('exports.files.automatic')}</Badge> },
    {
      key: 'download',
      header: '',
      width: '120px',
      cell: (row) =>
        row.hasFile && (
          <Button variant="ghost" aria-label={t('exports.files.downloadNamed', { date: dayMonthYear(row.cutoffDate) })} disabled={download.isPending} onClick={() => download.mutate(row.id)}>
            {t('exports.files.download')}
          </Button>
        ),
    },
    {
      key: 'process',
      header: '',
      width: '150px',
      cell: (row) => (
        <ButtonLink variant="ghost" to={cutoffBatchPath(row.id)} aria-label={t('exports.files.processNamed', { date: dayMonthYear(row.cutoffDate) })}>
          {t('exports.files.process')}
        </ButtonLink>
      ),
    },
  ];
  const result = generate.data;
  return (
    <div className={styles.form}>
      {canGenerate && (
        <div className={styles.buttons}>
          <Button variant="primary" disabled={generate.isPending} onClick={() => generate.mutate()}>
            {generate.isPending ? t('exports.files.generating') : t('exports.files.generate')}
          </Button>
        </div>
      )}
      {result !== undefined && (
        <Alert tone={result.cutoffs.length > 0 ? 'ok' : 'info'}>
          {result.cutoffs.length > 0 ? t('exports.files.generated', { count: result.cutoffs.length }) : t('exports.files.nothing')}
          {result.waitingLines > 0 && ` ${t('exports.files.waiting', { count: result.waitingLines })}`}
        </Alert>
      )}
      <WorkflowError error={generate.error ?? download.error} context="content" />
      <Table label={t('exports.files.label')} columns={columns} rows={cutoffs.data ?? []} rowKey={(row) => row.id} loading={cutoffs.data === undefined} empty={t('exports.files.empty')} />
    </div>
  );
}

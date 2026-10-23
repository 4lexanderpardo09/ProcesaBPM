import type { ExportCutoffResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { cutoffBatchPath } from '@/shared/lib/paths';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { Button, ButtonLink, PageHeader, Table, type TableColumn } from '@/shared/ui';
import { WorkflowError } from '../../components/WorkflowError';
import { myCutoffsQueryOptions } from '../api/exports-api';
import { useCutoffDownload } from '../components/ExportFilesTab';

const dayMonthYear = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** "Mis planos": the export files made for the person (exports split by a step's responsible), newest first. */
export function MyExportsPage() {
  const { t } = useTranslation('workflows');
  const files = useQuery(myCutoffsQueryOptions(useApiClient()));
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const download = useCutoffDownload(true);
  const columns: TableColumn<ExportCutoffResponse>[] = [
    { key: 'export', header: t('exports.mine.export'), cell: (row) => row.definitionName },
    { key: 'date', header: t('exports.files.date'), width: '110px', cell: (row) => dayMonthYear(row.cutoffDate) },
    { key: 'generatedAt', header: t('exports.files.generatedAt'), width: '170px', cell: (row) => formatDateTime(row.generatedAt, timeZone) },
    { key: 'lines', header: t('exports.files.lines'), width: '80px', cell: (row) => row.lineCount.toLocaleString('es-CO') },
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
  return (
    <>
      <PageHeader title={t('exports.mine.title')} subtitle={t('exports.mine.subtitle')} />
      <WorkflowError error={download.error} context="content" />
      <Table label={t('exports.mine.title')} columns={columns} rows={files.data ?? []} rowKey={(row) => row.id} loading={files.data === undefined} empty={t('exports.mine.empty')} />
    </>
  );
}

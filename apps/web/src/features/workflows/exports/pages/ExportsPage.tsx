import type { ExportDefinitionResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { exportPath, paths } from '@/shared/lib/paths';
import { useApiClient, useCurrentUser, usePermissions } from '@/shared/session';
import { Alert, Badge, Breadcrumb, ButtonLink, PageHeader, PlusIcon, Table, type TableColumn } from '@/shared/ui';
import workflowStyles from '../../components/Workflows.module.css';
import { exportsQueryOptions } from '../api/exports-api';
import { scheduleText } from '../lib/schedule-text';

/** The scheduled exports ("planos"): when each writes its lines, when it cuts, and how many lines wait for the next file. */
export function ExportsPage() {
  const { t } = useTranslation('workflows');
  const { can } = usePermissions();
  const exports = useQuery(exportsQueryOptions(useApiClient()));
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const columns: TableColumn<ExportDefinitionResponse>[] = [
    {
      key: 'name',
      header: t('exports.list.name'),
      cell: (row) => (
        <Link to={exportPath(row.id)} className={workflowStyles.link}>
          {row.name}
        </Link>
      ),
    },
    { key: 'workflow', header: t('exports.list.workflow'), cell: (row) => row.workflowName },
    { key: 'when', header: t('exports.list.when'), cell: (row) => (row.trigger === 'CLOSING' ? t('exports.trigger.CLOSING') : t('exports.trigger.TRANSITION', { label: row.transitionLabel ?? '' })) },
    { key: 'schedule', header: t('exports.list.schedule'), cell: (row) => scheduleText(t, row.schedule) },
    { key: 'pending', header: t('exports.list.pending'), width: '110px', cell: (row) => row.pendingLines.toLocaleString('es-CO') },
    { key: 'next', header: t('exports.list.next'), width: '170px', cell: (row) => (row.nextCutoffAt === null ? '—' : formatDateTime(row.nextCutoffAt, timeZone)) },
    { key: 'status', header: t('exports.list.status'), width: '110px', cell: (row) => (row.isActive ? <Badge tone="ok">{t('list.active')}</Badge> : <Badge>{t('list.inactive')}</Badge>) },
  ];

  return (
    <>
      <Breadcrumb label={t('detail.breadcrumb')} items={[{ label: t('detail.back'), to: paths.workflows }, { label: t('exports.title') }]} />
      <PageHeader
        title={t('exports.title')}
        subtitle={t('exports.subtitle')}
        actions={
          <>
            <ButtonLink to={paths.exportCatalogs}>{t('exports.catalogs')}</ButtonLink>
            {can('update', 'Export') && (
              <ButtonLink to={paths.newExport} variant="primary" icon={<PlusIcon size={15} />}>
                {t('exports.new')}
              </ButtonLink>
            )}
          </>
        }
      />
      {exports.isError ? (
        <Alert tone="danger">{t('exports.loadFailed')}</Alert>
      ) : (
        <Table label={t('exports.title')} columns={columns} rows={exports.data ?? []} rowKey={(row) => row.id} loading={exports.data === undefined} empty={t('exports.empty')} />
      )}
    </>
  );
}

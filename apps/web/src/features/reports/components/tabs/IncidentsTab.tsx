import type { IncidentGroupRow } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Card, Table } from '@/shared/ui';
import { incidentsQuery } from '../../api/reports-api';
import { formatCount, useFormatMinutes } from '../../lib/report-format';
import type { ReportFilters } from '../../lib/report-filters';
import { Bar } from '../Bar';
import { ExportButton } from '../ExportButton';
import { ReportState } from '../ReportState';
import styles from '../Reports.module.css';

/** The incidents of the period (the pauses), by step, by who reported them and by who solved them. */
export function IncidentsTab({ filters }: { readonly filters: ReportFilters }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const minutes = useFormatMinutes();
  const report = useQuery(incidentsQuery(client, filters));
  const group = (title: string, rows: readonly IncidentGroupRow[]) => {
    const most = Math.max(1, ...rows.map((row) => row.count));
    return (
      <Card title={title}>
        <Table<IncidentGroupRow>
          label={title}
          rows={rows}
          rowKey={(row) => row.key}
          empty={t('empty')}
          columns={[
            { key: 'group', header: t('incidents.group'), cell: (row) => row.label },
            { key: 'count', header: t('incidents.count'), width: '200px', cell: (row) => <Bar share={row.count / most} label={formatCount(row.count)} /> },
            { key: 'open', header: t('incidents.open'), code: true, width: '90px', cell: (row) => formatCount(row.open) },
            { key: 'resolved', header: t('incidents.resolved'), code: true, width: '90px', cell: (row) => formatCount(row.resolved) },
            { key: 'paused', header: t('incidents.avgPaused'), width: '130px', cell: (row) => minutes(row.avgPausedMin) },
          ]}
        />
      </Card>
    );
  };
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <span />
        <ExportButton report="incidents" filters={filters} />
      </div>
      <ReportState query={report}>
        {(data) => (
          <div className={styles.stack}>
            {group(t('incidents.byStep'), data.byStep)}
            {group(t('incidents.byOpener'), data.byOpener)}
            {group(t('incidents.byAssignee'), data.byAssignee)}
          </div>
        )}
      </ReportState>
    </div>
  );
}

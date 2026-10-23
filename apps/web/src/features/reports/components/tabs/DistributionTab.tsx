import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Card, Table } from '@/shared/ui';
import { distributionQuery } from '../../api/reports-api';
import { formatCount, useFormatMinutes } from '../../lib/report-format';
import type { ReportFilters } from '../../lib/report-filters';
import { ExportButton } from '../ExportButton';
import { ReportState } from '../ReportState';
import styles from '../Reports.module.css';

interface Spread {
  readonly min: number | null;
  readonly p25: number | null;
  readonly median: number | null;
  readonly p75: number | null;
  readonly p90: number | null;
  readonly max: number | null;
}

/** How spread out the times are, by step and by whole ticket: the median and the quartiles say more than an average. */
export function DistributionTab({ filters }: { readonly filters: ReportFilters }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const minutes = useFormatMinutes();
  const report = useQuery(distributionQuery(client, filters));
  const spread = <T extends Spread>() =>
    (['min', 'p25', 'median', 'p75', 'p90', 'max'] as const).map((key) => ({ key, header: t(`distribution.${key}`), width: '100px', cell: (row: T) => minutes(row[key]) }));
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <span />
        <ExportButton report="time-distribution" filters={filters} />
      </div>
      <ReportState query={report}>
        {(data) => (
          <div className={styles.stack}>
            <Card title={t('distribution.byStep')}>
              <Table
                label={t('distribution.byStep')}
                rows={data.byStep}
                rowKey={(row) => `${row.workflowId}:${row.stepName}`}
                empty={t('empty')}
                columns={[
                  { key: 'workflow', header: t('distribution.workflow'), cell: (row) => row.workflowName },
                  { key: 'step', header: t('distribution.step'), cell: (row) => row.stepName },
                  { key: 'count', header: t('distribution.count'), code: true, width: '80px', cell: (row) => formatCount(row.visits) },
                  ...spread<(typeof data.byStep)[number]>(),
                ]}
              />
            </Card>
            <Card title={t('distribution.byWorkflow')}>
              <Table
                label={t('distribution.byWorkflow')}
                rows={data.byWorkflow}
                rowKey={(row) => row.workflowId}
                empty={t('empty')}
                columns={[
                  { key: 'workflow', header: t('distribution.workflow'), cell: (row) => row.workflowName },
                  { key: 'count', header: t('distribution.count'), code: true, width: '80px', cell: (row) => formatCount(row.tickets) },
                  ...spread<(typeof data.byWorkflow)[number]>(),
                ]}
              />
            </Card>
          </div>
        )}
      </ReportState>
    </div>
  );
}

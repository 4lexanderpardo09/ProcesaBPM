import type { StepSlaRow } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Badge, Select, Table } from '@/shared/ui';
import { stepsQuery, type TicketDrill } from '../../api/reports-api';
import { formatCount, formatPct, useFormatMinutes } from '../../lib/report-format';
import type { ReportFilters } from '../../lib/report-filters';
import { Bar } from '../Bar';
import { ExportButton } from '../ExportButton';
import { ReportState } from '../ReportState';
import { ReportTicketsDialog } from '../ReportTicketsDialog';
import styles from '../Reports.module.css';

/** A step with fewer visits than this says little about its speed (the help desk's rule). */
export const MIN_VISITS = 5;
const TOPS = [10, 20, 30, 50] as const;
const HOUR = 60;

/** The help desk's levels: under 50 business hours on average, 50 to 100, 100 or more. */
export function bottleneckLevel(avgMin: number | null): 'NORMAL' | 'MODERATE' | 'CRITICAL' {
  if (avgMin === null || avgMin < 50 * HOUR) return 'NORMAL';
  return avgMin < 100 * HOUR ? 'MODERATE' : 'CRITICAL';
}

const LEVEL_TONE = { NORMAL: 'ok', MODERATE: 'warn', CRITICAL: 'danger' } as const;

/** The slowest steps of the workflows, among those with enough visits. */
export function StepsTab({ filters }: { readonly filters: ReportFilters }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const minutes = useFormatMinutes();
  const [top, setTop] = useState<number>(10);
  const [drill, setDrill] = useState<{ title: string; drill: TicketDrill }>();
  const report = useQuery(stepsQuery(client, filters));
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarStart}>
          <Select label={t('steps.top')} options={TOPS.map((value) => ({ value: String(value), label: t('steps.topOption', { count: value }) }))} value={String(top)} onChange={(event) => setTop(Number(event.target.value))} />
        </div>
        <ExportButton report="sla-steps" filters={filters} />
      </div>
      <p className={styles.note}>
        {t('steps.minVisits', { count: MIN_VISITS })} {t('steps.levelsHint')}
      </p>
      <ReportState query={report}>
        {(rows) => {
          const slowest = rows
            .filter((row) => row.visits >= MIN_VISITS)
            .toSorted((a, b) => (b.avgMin ?? 0) - (a.avgMin ?? 0))
            .slice(0, top);
          const longest = Math.max(1, ...slowest.map((row) => row.avgMin ?? 0));
          return (
            <Table<StepSlaRow>
              label={t('tabs.steps')}
              rows={slowest}
              rowKey={(row) => `${row.workflowId}:${row.stepName}`}
              empty={t('empty')}
              columns={[
                { key: 'workflow', header: t('steps.workflow'), cell: (row) => row.workflowName },
                {
                  key: 'step',
                  header: t('steps.step'),
                  cell: (row) => (
                    <button type="button" className={styles.linkButton} onClick={() => setDrill({ title: t('tickets.of.step', { name: row.stepName }), drill: { workflowId: row.workflowId, stepName: row.stepName } })}>
                      {row.stepName}
                    </button>
                  ),
                },
                { key: 'avg', header: t('steps.avg'), width: '220px', cell: (row) => <Bar share={(row.avgMin ?? 0) / longest} label={minutes(row.avgMin)} /> },
                {
                  key: 'level',
                  header: t('steps.level'),
                  width: '110px',
                  cell: (row) => {
                    const level = bottleneckLevel(row.avgMin);
                    return <Badge tone={LEVEL_TONE[level]}>{t(`steps.levels.${level}`)}</Badge>;
                  },
                },
                { key: 'visits', header: t('steps.visits'), code: true, width: '80px', cell: (row) => formatCount(row.visits) },
                { key: 'p90', header: t('steps.p90'), width: '110px', cell: (row) => minutes(row.p90Min) },
                { key: 'compliance', header: t('steps.compliance'), code: true, width: '110px', cell: (row) => formatPct(row.compliancePct) },
                { key: 'reprocesses', header: t('steps.reprocesses'), code: true, width: '100px', cell: (row) => formatCount(row.reprocesses) },
              ]}
            />
          );
        }}
      </ReportState>
      {drill !== undefined && <ReportTicketsDialog title={drill.title} filters={filters} drill={drill.drill} onClose={() => setDrill(undefined)} />}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { summaryQuery } from '../../api/reports-api';
import { formatCount, formatPct, useFormatMinutes } from '../../lib/report-format';
import type { ReportFilters } from '../../lib/report-filters';
import { ExportButton } from '../ExportButton';
import { ReportState } from '../ReportState';
import styles from '../Reports.module.css';

function Tile({ label, value, hint }: { readonly label: string; readonly value: string; readonly hint?: string }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileLabel}>{label}</span>
      {hint !== undefined && <span className={styles.tileHint}>{hint}</span>}
    </div>
  );
}

/** The headline numbers of the period. */
export function SummaryTab({ filters }: { readonly filters: ReportFilters }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const minutes = useFormatMinutes();
  const summary = useQuery(summaryQuery(client, filters));
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <span />
        <ExportButton report="summary" filters={filters} />
      </div>
      <ReportState query={summary}>
        {(data) => (
          <div className={styles.stack}>
            <div className={styles.tiles}>
              <Tile label={t('summary.created')} value={formatCount(data.created)} />
              <Tile label={t('summary.closed')} value={formatCount(data.closed)} />
              <Tile label={t('summary.open')} value={formatCount(data.open)} />
              <Tile label={t('summary.stepOnTime')} value={formatPct(data.stepOnTimePct)} hint={t('summary.stepOnTimeHint')} />
              <Tile label={t('summary.responsibleOnTime')} value={formatPct(data.responsibleOnTimePct)} hint={t('summary.responsibleOnTimeHint')} />
              <Tile label={t('summary.avgResolution')} value={minutes(data.avgResolutionMin)} />
              <Tile label={t('summary.medianResolution')} value={minutes(data.medianResolutionMin)} />
            </div>
            {data.unmeasuredTickets > 0 && <p className={styles.note}>{t('summary.unmeasured', { count: data.unmeasuredTickets })}</p>}
          </div>
        )}
      </ReportState>
    </div>
  );
}

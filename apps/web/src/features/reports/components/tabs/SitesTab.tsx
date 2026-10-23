import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sitesQueryOptions } from '@/features/people';
import { useApiClient } from '@/shared/session';
import { Select, Table } from '@/shared/ui';
import { type SiteReportData, sitesQuery, type TicketDrill } from '../../api/reports-api';
import { formatCount, formatPct, useFormatMinutes } from '../../lib/report-format';
import type { ReportFilters } from '../../lib/report-filters';
import { Bar } from '../Bar';
import { ExportButton } from '../ExportButton';
import { ReportState } from '../ReportState';
import { ReportTicketsDialog } from '../ReportTicketsDialog';
import styles from '../Reports.module.css';

type SiteRow = SiteReportData['rows'][number];

/** Compliance against the target, in a state people read in words as well as color. */
export function complianceTone(pct: number | null, target: number): 'ok' | 'warn' | 'danger' | undefined {
  if (pct === null) return undefined;
  if (pct >= target) return 'ok';
  return pct >= target - 15 ? 'warn' : 'danger';
}

/** The levels of the organization's site tree, to choose how sites are grouped. */
export function useSiteLevels(): number[] {
  const client = useApiClient();
  const sites = useQuery(sitesQueryOptions(client));
  const deepest = Math.max(1, ...(sites.data ?? []).map((site) => site.level));
  return Array.from({ length: deepest }, (_, index) => index + 1);
}

/** The help desk's regions: each site at the chosen level, its compliance against the target, its errors and its time. */
export function SitesTab({ filters, level, onLevel }: { readonly filters: ReportFilters; readonly level: number; readonly onLevel: (level: number) => void }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const minutes = useFormatMinutes();
  const levels = useSiteLevels();
  const [drill, setDrill] = useState<{ title: string; drill: TicketDrill }>();
  const report = useQuery(sitesQuery(client, filters, level));
  const name = (row: SiteRow) => row.siteName ?? t('sites.noSite');
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarStart}>
          <Select label={t('sites.level')} options={levels.map((value) => ({ value: String(value), label: t('sites.levelOption', { level: value }) }))} value={String(level)} onChange={(event) => onLevel(Number(event.target.value))} />
        </div>
        <ExportButton report="sites" filters={filters} extra={{ level }} />
      </div>
      <ReportState query={report}>
        {(data) => (
          <div className={styles.stack}>
            <p className={styles.note}>{t('sites.chart', { pct: data.targetPct })}</p>
            <Table<SiteRow>
              label={t('tabs.sites')}
              rows={data.rows}
              rowKey={(row) => row.siteId ?? 'none'}
              empty={t('empty')}
              columns={[
                {
                  key: 'site',
                  header: t('sites.site'),
                  cell: (row) => (
                    <button type="button" className={styles.linkButton} onClick={() => setDrill({ title: row.siteId === null ? t('tickets.of.noSite') : t('tickets.of.site', { name: name(row) }), drill: row.siteId === null ? { noSite: 'true' } : { underSiteId: row.siteId } })}>
                      {name(row)}
                    </button>
                  ),
                },
                { key: 'tickets', header: t('sites.tickets'), code: true, width: '80px', cell: (row) => formatCount(row.tickets) },
                { key: 'people', header: t('sites.responsibles'), code: true, width: '80px', cell: (row) => formatCount(row.responsibles) },
                {
                  key: 'compliance',
                  header: `${t('sites.compliance')} · ${t('sites.target', { pct: data.targetPct })}`,
                  width: '240px',
                  cell: (row) => {
                    const tone = complianceTone(row.compliancePct, data.targetPct);
                    const state = tone === undefined ? '' : ` · ${tone === 'ok' ? t('sites.onTarget') : t('sites.belowTarget')}`;
                    return <Bar share={(row.compliancePct ?? 0) / 100} target={data.targetPct / 100} tone={tone} label={`${formatPct(row.compliancePct)}${state}`} />;
                  },
                },
                { key: 'errors', header: t('sites.errors'), width: '150px', cell: (row) => t('sites.errorDetail', { process: row.processErrors, other: row.otherErrors }) },
                { key: 'errorPct', header: t('sites.errorPct'), code: true, width: '110px', cell: (row) => formatPct(row.errorPct) },
                { key: 'avg', header: t('sites.avg'), width: '120px', cell: (row) => minutes(row.avgMin) },
              ]}
            />
          </div>
        )}
      </ReportState>
      {drill !== undefined && <ReportTicketsDialog title={drill.title} filters={filters} drill={drill.drill} onClose={() => setDrill(undefined)} />}
    </div>
  );
}

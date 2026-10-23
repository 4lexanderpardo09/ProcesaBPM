import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { cx } from '@/shared/lib/cx';
import { Card, Select, Table } from '@/shared/ui';
import { type HeatmapData, heatmapQuery } from '../../api/reports-api';
import { formatCount, useFormatMinutes } from '../../lib/report-format';
import type { ReportFilters } from '../../lib/report-filters';
import { ExportButton } from '../ExportButton';
import { ReportState } from '../ReportState';
import styles from '../Reports.module.css';
import { useSiteLevels } from './SitesTab';

type Person = HeatmapData['sites'][number]['users'][number];

/** How much slower than the site is worth a look (yellow) or a red flag. */
const SLOWER_WARN = 25;
const SLOWER_DANGER = 50;

function Cell({ value, tone }: { readonly value: string; readonly tone: 'danger' | 'warn' | 'ok' | undefined }) {
  return <span className={cx(styles.cell, tone === 'danger' && styles.cellDanger, tone === 'warn' && styles.cellWarn, tone === 'ok' && styles.cellOk)}>{value}</span>;
}

/** Each site's people side by side: serious errors in red, minor ones in yellow, and their time against the site's. */
export function HeatmapTab({ filters, level, onLevel }: { readonly filters: ReportFilters; readonly level: number; readonly onLevel: (level: number) => void }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const minutes = useFormatMinutes();
  const levels = useSiteLevels();
  const report = useQuery(heatmapQuery(client, filters, level));
  const vsPeers = (row: Person) => {
    if (row.vsPeersPct === null) return <Cell value={t('none')} tone={undefined} />;
    const text = row.vsPeersPct > 0 ? t('heatmap.slower', { pct: row.vsPeersPct }) : row.vsPeersPct < 0 ? t('heatmap.faster', { pct: -row.vsPeersPct }) : t('heatmap.same');
    return <Cell value={text} tone={row.vsPeersPct >= SLOWER_DANGER ? 'danger' : row.vsPeersPct >= SLOWER_WARN ? 'warn' : row.vsPeersPct <= 0 ? 'ok' : undefined} />;
  };
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarStart}>
          <Select label={t('sites.level')} options={levels.map((value) => ({ value: String(value), label: t('sites.levelOption', { level: value }) }))} value={String(level)} onChange={(event) => onLevel(Number(event.target.value))} />
        </div>
        <ExportButton report="heatmap" filters={filters} extra={{ level }} />
      </div>
      <p className={styles.note}>{t('heatmap.hint')}</p>
      <ReportState query={report}>
        {(data) =>
          data.sites.length === 0 ? (
            <p className={styles.note}>{t('empty')}</p>
          ) : (
            <div className={styles.stack}>
              {data.sites.map((site) => (
                <Card
                  key={site.siteId ?? 'none'}
                  title={
                    <span className={styles.siteHeading}>
                      <span>{site.siteName ?? t('sites.noSite')}</span>
                      <span className={styles.note}>{t('heatmap.siteAvg', { time: minutes(site.avgMin) })}</span>
                    </span>
                  }
                >
                  <Table<Person>
                    label={site.siteName ?? t('sites.noSite')}
                    rows={site.users}
                    rowKey={(row) => row.userId}
                    empty={t('empty')}
                    columns={[
                      { key: 'user', header: t('heatmap.user'), cell: (row) => row.name ?? t('none') },
                      { key: 'delivered', header: t('heatmap.delivered'), code: true, width: '80px', cell: (row) => formatCount(row.delivered) },
                      { key: 'process', header: t('heatmap.processErrors'), width: '120px', cell: (row) => <Cell value={formatCount(row.processErrors)} tone={row.processErrors > 0 ? 'danger' : undefined} /> },
                      { key: 'other', header: t('heatmap.otherErrors'), width: '120px', cell: (row) => <Cell value={formatCount(row.otherErrors)} tone={row.otherErrors > 0 ? 'warn' : undefined} /> },
                      { key: 'avg', header: t('heatmap.avg'), width: '120px', cell: (row) => minutes(row.avgMin) },
                      { key: 'peers', header: t('heatmap.vsPeers'), width: '150px', cell: vsPeers },
                    ]}
                  />
                </Card>
              ))}
            </div>
          )
        }
      </ReportState>
    </div>
  );
}

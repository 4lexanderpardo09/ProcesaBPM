import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Badge, type BadgeTone, Select, Table } from '@/shared/ui';
import { rankingQuery, type RankingRow } from '../../api/reports-api';
import { formatCount, formatPct, useFormatMinutes } from '../../lib/report-format';
import type { ReportFilters } from '../../lib/report-filters';
import { Bar } from '../Bar';
import { ExportButton } from '../ExportButton';
import { ReportState } from '../ReportState';
import { ReportTicketsDialog } from '../ReportTicketsDialog';
import styles from '../Reports.module.css';

const VOLUMES = [1, 3, 5, 10, 20] as const;
const TONES: Readonly<Record<NonNullable<RankingRow['classification']>, BadgeTone>> = { GREEN: 'ok', YELLOW: 'warn', RED: 'danger' };
const number = (value: number | null, digits: number) => (value === null ? null : value.toLocaleString('es-CO', { maximumFractionDigits: digits }));

/**
 * People by the help desk's weighted score: 70 % compliance and 30 % quality, weighted by volume and process errors,
 * colored against the best of the period. Below the minimum volume they are listed without a position.
 */
export function RankingTab({ filters }: { readonly filters: ReportFilters }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const minutes = useFormatMinutes();
  const [minVolume, setMinVolume] = useState(1);
  const [person, setPerson] = useState<RankingRow>();
  const ranking = useQuery(rankingQuery(client, filters, minVolume));
  const best = ranking.data?.ranked[0]?.weighted ?? 0;
  const columns = [
    { key: 'rank', header: t('ranking.rank'), width: '48px', code: true, cell: (row: RankingRow) => row.rank ?? t('none') },
    {
      key: 'user',
      header: t('ranking.user'),
      cell: (row: RankingRow) => (
        <button type="button" className={styles.linkButton} onClick={() => setPerson(row)}>
          {row.name}
        </button>
      ),
    },
    { key: 'handled', header: t('ranking.handled'), code: true, width: '100px', cell: (row: RankingRow) => formatCount(row.handled) },
    { key: 'delivered', header: t('ranking.delivered'), code: true, width: '80px', cell: (row: RankingRow) => formatCount(row.delivered) },
    { key: 'late', header: t('ranking.late'), code: true, width: '90px', cell: (row: RankingRow) => formatCount(row.late) },
    { key: 'errors', header: t('ranking.errors'), code: true, width: '80px', cell: (row: RankingRow) => formatCount(row.errors) },
    { key: 'compliance', header: t('ranking.compliance'), code: true, width: '110px', cell: (row: RankingRow) => formatPct(row.compliance === null ? null : Math.round(row.compliance * 1000) / 10) },
    { key: 'quality', header: t('ranking.quality'), code: true, width: '90px', cell: (row: RankingRow) => formatPct(row.quality === null ? null : Math.round(row.quality * 1000) / 10) },
    { key: 'score', header: t('ranking.score'), code: true, width: '90px', cell: (row: RankingRow) => number(row.score, 1) ?? t('none') },
    {
      key: 'weighted',
      header: t('ranking.weighted'),
      width: '220px',
      cell: (row: RankingRow) => <Bar share={row.weighted === null || best === 0 ? 0 : row.weighted / best} label={number(row.weighted, 1) ?? t('none')} />,
    },
    { key: 'classification', header: t('ranking.classification'), width: '110px', cell: (row: RankingRow) => (row.classification === null ? t('none') : <Badge tone={TONES[row.classification]}>{t(`ranking.classes.${row.classification}`)}</Badge>) },
    { key: 'median', header: t('ranking.median'), width: '120px', cell: (row: RankingRow) => minutes(row.medianMin) },
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarStart}>
          <Select label={t('ranking.minVolume')} options={VOLUMES.map((value) => ({ value: String(value), label: String(value) }))} value={String(minVolume)} onChange={(event) => setMinVolume(Number(event.target.value))} />
        </div>
        <ExportButton report="ranking" filters={filters} extra={{ minVolume }} />
      </div>
      <p className={styles.note}>{t('ranking.hint')}</p>
      <ReportState query={ranking}>
        {(data) => (
          <div className={styles.stack}>
            <Table<RankingRow> label={t('tabs.ranking')} columns={columns} rows={data.ranked} rowKey={(row) => row.userId} empty={t('empty')} />
            {data.unranked.length > 0 && (
              <>
                <h3 className={styles.downloadTitle}>{t('ranking.unranked')}</h3>
                <Table<RankingRow> label={t('ranking.unranked')} columns={columns} rows={data.unranked} rowKey={(row) => row.userId} empty={t('empty')} />
              </>
            )}
          </div>
        )}
      </ReportState>
      {person !== undefined && <ReportTicketsDialog title={t('tickets.of.person', { name: person.name })} filters={filters} drill={{ responsibleId: person.userId }} onClose={() => setPerson(undefined)} />}
    </div>
  );
}

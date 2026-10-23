import type { ResponsibleSlaRow, UserClockRow } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { useApiClient } from '@/shared/session';
import { Badge, Button, Dialog, Pagination, Table } from '@/shared/ui';
import { responsiblesQuery, userDetailQuery } from '../../api/reports-api';
import { formatCount, formatPct, useFormatMinutes } from '../../lib/report-format';
import type { ReportFilters } from '../../lib/report-filters';
import { ExportButton } from '../ExportButton';
import { ReportError, ReportState } from '../ReportState';
import { ReportTicketsDialog } from '../ReportTicketsDialog';
import styles from '../Reports.module.css';

interface Person {
  readonly userId: string;
  readonly name: string;
}

function UserDetailDialog({ filters, person, onClose }: { readonly filters: ReportFilters; readonly person: Person; readonly onClose: () => void }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const minutes = useFormatMinutes();
  const [page, setPage] = useState(1);
  const [tickets, setTickets] = useState(false);
  const detail = useQuery(userDetailQuery(client, filters, person.userId, page));
  const result = (row: UserClockRow) =>
    row.completedAt === null ? <Badge tone="accent">{t('people.results.running')}</Badge> : row.result === null ? <Badge>{t('people.results.noSla')}</Badge> : <Badge tone={row.result === 'ON_TIME' ? 'ok' : 'danger'}>{t(`people.results.${row.result}`)}</Badge>;
  const title = t('people.detailTitle', { name: person.name });
  return (
    <Dialog
      open
      title={title}
      closeLabel={t('tickets.close')}
      onClose={onClose}
      footer={
        <>
          <ExportButton report="user-detail" filters={filters} extra={{ userId: person.userId }} />
          <Button onClick={() => setTickets(true)}>{t('people.seeTickets')}</Button>
          <Button onClick={onClose}>{t('tickets.close')}</Button>
        </>
      }
    >
      <div className={styles.stack}>
        {detail.isError && <ReportError error={detail.error} />}
        {detail.data?.summary != null && (
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <span className={styles.tileValue}>{formatCount(detail.data.summary.delivered)}</span>
              <span className={styles.tileLabel}>{t('ranking.delivered')}</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileValue}>{formatPct(detail.data.summary.compliance === null ? null : Math.round(detail.data.summary.compliance * 1000) / 10)}</span>
              <span className={styles.tileLabel}>{t('ranking.compliance')}</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileValue}>{formatCount(detail.data.summary.errors)}</span>
              <span className={styles.tileLabel}>{t('ranking.errors')}</span>
            </div>
            <div className={styles.tile}>
              <span className={styles.tileValue}>{minutes(detail.data.summary.medianMin)}</span>
              <span className={styles.tileLabel}>{t('ranking.median')}</span>
            </div>
          </div>
        )}
        <h3 className={styles.downloadTitle}>{t('people.clocksTitle')}</h3>
        <Table<UserClockRow>
          label={t('people.clocksTitle')}
          rows={detail.data?.clocks.items ?? []}
          rowKey={(row) => `${row.ticketNumber}:${row.stepName}:${row.loop}:${row.startedAt}`}
          loading={detail.data === undefined && !detail.isError}
          loadingLabel={t('loading')}
          empty={t('empty')}
          columns={[
            { key: 'ticket', header: t('people.ticket'), code: true, width: '84px', cell: (row) => row.ticketNumber },
            { key: 'step', header: t('people.step'), cell: (row) => `${row.workflowName} · ${row.stepName}` },
            { key: 'started', header: t('people.started'), width: '150px', cell: (row) => formatDateTime(row.startedAt) },
            { key: 'business', header: t('people.business'), width: '120px', cell: (row) => minutes(row.businessMin) },
            { key: 'result', header: t('people.result'), width: '110px', cell: result },
          ]}
        />
        {detail.data !== undefined && <Pagination page={detail.data.clocks.page} pageSize={detail.data.clocks.pageSize} total={detail.data.clocks.total} onChange={setPage} />}
      </div>
      {tickets && <ReportTicketsDialog title={t('tickets.of.person', { name: person.name })} filters={filters} drill={{ responsibleId: person.userId }} onClose={() => setTickets(false)} />}
    </Dialog>
  );
}

/** Each person's clocks of the period, and their detail. */
export function PeopleTab({ filters }: { readonly filters: ReportFilters }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const minutes = useFormatMinutes();
  const [page, setPage] = useState(1);
  const [person, setPerson] = useState<Person>();
  const report = useQuery(responsiblesQuery(client, filters, page));
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <span />
        <ExportButton report="sla-responsibles" filters={filters} />
      </div>
      <ReportState query={report}>
        {(data) => (
          <div className={styles.stack}>
            <Table<ResponsibleSlaRow>
              label={t('tabs.people')}
              rows={data.items}
              rowKey={(row) => row.userId ?? 'pool'}
              empty={t('empty')}
              columns={[
                {
                  key: 'user',
                  header: t('people.user'),
                  cell: (row) =>
                    row.userId === null ? (
                      t('people.pool')
                    ) : (
                      <button type="button" className={styles.linkButton} aria-label={t('people.detail', { name: row.name ?? '' })} onClick={() => setPerson({ userId: row.userId!, name: row.name ?? '' })}>
                        {row.name}
                      </button>
                    ),
                },
                { key: 'clocks', header: t('people.clocks'), code: true, width: '80px', cell: (row) => formatCount(row.clocks) },
                { key: 'onTime', header: t('people.onTime'), code: true, width: '90px', cell: (row) => formatCount(row.onTime) },
                { key: 'late', header: t('people.late'), code: true, width: '90px', cell: (row) => formatCount(row.late) },
                { key: 'handedOff', header: t('people.handedOff'), code: true, width: '110px', cell: (row) => formatCount(row.handedOff) },
                { key: 'compliance', header: t('people.compliance'), code: true, width: '110px', cell: (row) => formatPct(row.compliancePct) },
                { key: 'avg', header: t('people.avg'), width: '120px', cell: (row) => minutes(row.avgMin) },
                { key: 'paused', header: t('people.paused'), width: '120px', cell: (row) => minutes(row.avgPausedMin) },
              ]}
            />
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
          </div>
        )}
      </ReportState>
      {person !== undefined && <UserDetailDialog filters={filters} person={person} onClose={() => setPerson(undefined)} />}
    </div>
  );
}

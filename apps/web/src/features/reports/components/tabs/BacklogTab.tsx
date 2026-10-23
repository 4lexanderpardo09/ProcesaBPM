import type { BacklogReport } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { TicketStatusBadge } from '@/features/tickets';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { ticketPath } from '@/shared/lib/paths';
import { useApiClient } from '@/shared/session';
import { Badge, Button, Dialog, Pagination, Table } from '@/shared/ui';
import { type BacklogTicket, backlogQuery, backlogTicketsQuery } from '../../api/reports-api';
import { formatCount } from '../../lib/report-format';
import type { ReportFilters } from '../../lib/report-filters';
import { ExportButton } from '../ExportButton';
import { ReportError, ReportState } from '../ReportState';
import styles from '../Reports.module.css';

type BacklogRow = BacklogReport['rows'][number];

/** The help desk's color for an open count: green up to 20, yellow up to 50, red above. */
const countTone = (count: number) => (count > 50 ? 'danger' : count > 20 ? 'warn' : 'ok');
/** And for a ticket's age: green up to 3 days, yellow up to 7, red above. */
const ageTone = (days: number) => (days > 7 ? 'danger' : days > 3 ? 'warn' : 'ok');
const BUCKETS = ['b0', 'b1', 'b2', 'b3'] as const;

function StepTicketsDialog({ filters, row, onClose }: { readonly filters: ReportFilters; readonly row: BacklogRow; readonly onClose: () => void }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const [page, setPage] = useState(1);
  const tickets = useQuery(backlogTicketsQuery(client, filters, row.workflowId, row.stepName, page));
  const title = t('backlog.ticketsTitle', { step: row.stepName, workflow: row.workflowName });
  return (
    <Dialog open title={title} closeLabel={t('tickets.close')} onClose={onClose} footer={<Button onClick={onClose}>{t('tickets.close')}</Button>}>
      <div className={styles.stack}>
        {tickets.isError && <ReportError error={tickets.error} />}
        <Table<BacklogTicket>
          label={title}
          rows={tickets.data?.items ?? []}
          rowKey={(ticket) => ticket.id}
          loading={tickets.data === undefined && !tickets.isError}
          loadingLabel={t('loading')}
          empty={t('empty')}
          columns={[
            {
              key: 'number',
              header: t('tickets.number'),
              code: true,
              width: '84px',
              cell: (ticket) => (
                <Link to={ticketPath(ticket.id)} aria-label={t('tickets.open', { number: ticket.number })}>
                  {ticket.number}
                </Link>
              ),
            },
            { key: 'subject', header: t('tickets.subject'), cell: (ticket) => ticket.title },
            { key: 'status', header: t('tickets.status'), width: '110px', cell: (ticket) => <TicketStatusBadge status={ticket.status} /> },
            { key: 'assignees', header: t('backlog.assignees'), cell: (ticket) => ticket.assigneeNames.join(', ') || t('none') },
            {
              key: 'age',
              header: t('backlog.age'),
              width: '140px',
              cell: (ticket) => (
                <span className={styles.state}>
                  <Badge tone={ageTone(ticket.ageDays)}>{t('backlog.days', { count: ticket.ageDays })}</Badge>
                  {ticket.overdue && <Badge tone="danger">{t('backlog.overdueBadge')}</Badge>}
                </span>
              ),
            },
            { key: 'since', header: t('backlog.since'), width: '150px', cell: (ticket) => (ticket.enteredStepAt === null ? t('none') : formatDateTime(ticket.enteredStepAt)) },
          ]}
        />
        {tickets.data !== undefined && <Pagination page={tickets.data.page} pageSize={tickets.data.pageSize} total={tickets.data.total} onChange={setPage} />}
      </div>
    </Dialog>
  );
}

/** What is open now in each step of each workflow, how old it is, and the tickets themselves. */
export function BacklogTab({ filters }: { readonly filters: ReportFilters }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const [step, setStep] = useState<BacklogRow>();
  const report = useQuery(backlogQuery(client, filters));
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <span />
        <ExportButton report="backlog" filters={{ ...filters, from: '', to: '' }} />
      </div>
      <ReportState query={report}>
        {(data) => (
          <div className={styles.stack}>
            <p className={styles.note}>{t('backlog.asOf', { time: formatDateTime(data.asOf) })}</p>
            <Table<BacklogRow>
              label={t('tabs.backlog')}
              rows={data.rows}
              rowKey={(row) => `${row.workflowId}:${row.stepName}`}
              empty={t('empty')}
              columns={[
                { key: 'workflow', header: t('backlog.workflow'), cell: (row) => row.workflowName },
                {
                  key: 'step',
                  header: t('backlog.step'),
                  cell: (row) => (
                    <button type="button" className={styles.linkButton} aria-label={t('backlog.see', { step: row.stepName })} onClick={() => setStep(row)}>
                      {row.stepName}
                    </button>
                  ),
                },
                { key: 'open', header: t('backlog.open'), width: '100px', cell: (row) => <Badge tone={countTone(row.open + row.paused)}>{formatCount(row.open + row.paused)}</Badge> },
                { key: 'paused', header: t('backlog.paused'), code: true, width: '90px', cell: (row) => formatCount(row.paused) },
                { key: 'overdue', header: t('backlog.overdue'), code: true, width: '90px', cell: (row) => formatCount(row.overdue) },
                { key: 'age', header: t('backlog.avgAge'), width: '190px', cell: (row) => (row.avgAgeDays === null ? t('none') : t('backlog.days', { count: Math.round(row.avgAgeDays) })) },
                {
                  key: 'buckets',
                  header: t('backlog.buckets'),
                  width: '220px',
                  cell: (row) => (
                    <span className={styles.buckets}>
                      {row.ageBuckets.map((value, index) => (
                        <span key={BUCKETS[index]} className={styles.bucket} title={t(`backlog.bucketLabels.${BUCKETS[index]!}`)}>
                          {t(`backlog.bucketLabels.${BUCKETS[index]!}`)}: {value}
                        </span>
                      ))}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        )}
      </ReportState>
      {step !== undefined && <StepTicketsDialog filters={filters} row={step} onClose={() => setStep(undefined)} />}
    </div>
  );
}

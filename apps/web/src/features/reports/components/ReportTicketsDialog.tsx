import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { TicketStatusBadge } from '@/features/tickets';
import { formatShortDate } from '@/shared/lib/format-date-time';
import { ticketPath } from '@/shared/lib/paths';
import { useApiClient } from '@/shared/session';
import { Button, Dialog, Pagination, Table } from '@/shared/ui';
import { type ReportTicket, reportTicketsQuery, type TicketDrill } from '../api/reports-api';
import type { ReportFilters } from '../lib/report-filters';
import { ReportError } from './ReportState';
import styles from './Reports.module.css';

export interface ReportTicketsDialogProps {
  readonly title: string;
  readonly filters: ReportFilters;
  readonly drill: TicketDrill;
  readonly onClose: () => void;
}

/** The tickets behind a number of a report, each one a link to it. */
export function ReportTicketsDialog({ title, filters, drill, onClose }: ReportTicketsDialogProps) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const [page, setPage] = useState(1);
  const tickets = useQuery(reportTicketsQuery(client, filters, drill, page));
  return (
    <Dialog open title={title} closeLabel={t('tickets.close')} onClose={onClose} footer={<Button onClick={onClose}>{t('tickets.close')}</Button>}>
      <div className={styles.stack}>
        {tickets.isError && <ReportError error={tickets.error} />}
        {tickets.data !== undefined && <p className={styles.note}>{t('tickets.total', { count: tickets.data.total })}</p>}
        <Table<ReportTicket>
          label={title}
          rows={tickets.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={tickets.data === undefined && !tickets.isError}
          loadingLabel={t('loading')}
          empty={t('empty')}
          columns={[
            {
              key: 'number',
              header: t('tickets.number'),
              code: true,
              width: '84px',
              cell: (row) => (
                <Link to={ticketPath(row.id)} aria-label={t('tickets.open', { number: row.number })}>
                  {row.number}
                </Link>
              ),
            },
            { key: 'subject', header: t('tickets.subject'), cell: (row) => row.title },
            { key: 'status', header: t('tickets.status'), width: '110px', cell: (row) => <TicketStatusBadge status={row.status} /> },
            { key: 'step', header: t('tickets.step'), cell: (row) => row.currentStepName ?? t('none') },
            { key: 'site', header: t('tickets.site'), cell: (row) => row.siteName ?? t('none') },
            { key: 'created', header: t('tickets.created'), width: '110px', cell: (row) => formatShortDate(row.createdAt) },
          ]}
        />
        {tickets.data !== undefined && <Pagination page={tickets.data.page} pageSize={tickets.data.pageSize} total={tickets.data.total} onChange={setPage} />}
      </div>
    </Dialog>
  );
}

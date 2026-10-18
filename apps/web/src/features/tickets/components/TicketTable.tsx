import type { TicketSummaryResponse } from '@procesabpm/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { formatShortDate } from '@/shared/lib/format-date-time';
import { ticketPath } from '@/shared/lib/paths';
import { Table, type TableColumn } from '@/shared/ui';
import styles from './TicketTable.module.css';
import { TicketStatusBadge } from './TicketStatusBadge';
import { TicketTags } from './TicketTags';

export interface TicketTableProps {
  readonly tickets: readonly TicketSummaryResponse[];
  readonly loading: boolean;
  readonly empty: string;
  readonly timeZone: string | undefined;
  readonly footer?: ReactNode;
}

export function TicketTable({ tickets, loading, empty, timeZone, footer }: TicketTableProps) {
  const { t } = useTranslation('tickets');
  const navigate = useNavigate();
  const columns: readonly TableColumn<TicketSummaryResponse>[] = [
    { key: 'number', header: t('columns.number'), cell: (ticket) => ticket.number, code: true, width: '112px' },
    {
      key: 'title',
      header: t('columns.title'),
      cell: (ticket) => (
        <Link to={ticketPath(ticket.id)} className={styles.title} onClick={(event) => event.stopPropagation()}>
          {ticket.title}
        </Link>
      ),
    },
    { key: 'status', header: t('columns.status'), cell: (ticket) => <TicketStatusBadge status={ticket.status} />, width: '128px' },
    { key: 'createdAt', header: t('columns.createdAt'), cell: (ticket) => <span className={styles.date}>{formatShortDate(ticket.createdAt, timeZone)}</span>, width: '132px' },
    { key: 'tags', header: t('columns.tags'), cell: (ticket) => <TicketTags tags={ticket.tags} />, width: '22%' },
  ];
  return (
    <Table
      label={t('inbox.tableLabel')}
      columns={columns}
      rows={tickets}
      rowKey={(ticket) => ticket.id}
      empty={empty}
      loading={loading}
      loadingLabel={t('inbox.loading')}
      onRowClick={(ticket) => void navigate(ticketPath(ticket.id))}
      footer={footer}
    />
  );
}

import type { SortDirection, TicketSort, TicketSummaryResponse } from '@procesabpm/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { formatShortDateTime } from '@/shared/lib/format-date-time';
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
  /** How the rows are sorted, and what a click on a sortable header asks for. */
  readonly sort: TicketSort;
  readonly direction: SortDirection;
  readonly onSort: (sort: TicketSort, direction: SortDirection) => void;
  /** The label of the field the listing is filtered by: it gets a column with each ticket's value. */
  readonly fieldLabel?: string | undefined;
}

/** A name with nothing shown for none. */
const nameOr = (name: string | undefined) => name ?? '—';

/**
 * The inbox, with the columns of the help desk: number, subject, the filtered field (when there is one), requester,
 * who holds it, state, the requester's and the workflow's priorities, tags and last activity. Every header but the
 * assignees and tags sorts; a second click on the same one turns the order around.
 */
export function TicketTable({ tickets, loading, empty, timeZone, footer, sort, direction, onSort, fieldLabel }: TicketTableProps) {
  const { t } = useTranslation('tickets');
  const navigate = useNavigate();
  const sortable = (key: TicketSort) => ({
    sort: {
      direction: sort === key ? direction : undefined,
      onSort: () => onSort(key, sort === key && direction === 'desc' ? 'asc' : 'desc'),
    },
  });
  const columns: readonly TableColumn<TicketSummaryResponse>[] = [
    { key: 'number', header: t('columns.number'), cell: (ticket) => ticket.number, code: true, width: '96px', ...sortable('number') },
    {
      key: 'title',
      header: t('columns.title'),
      cell: (ticket) => (
        <Link to={ticketPath(ticket.id)} className={styles.title} onClick={(event) => event.stopPropagation()}>
          {ticket.title}
        </Link>
      ),
      width: '22%',
      ...sortable('title'),
    },
    ...(fieldLabel === undefined ? [] : [{ key: 'field', header: fieldLabel, cell: (ticket: TicketSummaryResponse) => (ticket.filteredValue === null ? '—' : String(ticket.filteredValue)), width: '140px' }]),
    { key: 'requester', header: t('columns.requester'), cell: (ticket) => ticket.creator.name, width: '150px', ...sortable('requester') },
    {
      key: 'assignees',
      header: t('columns.assignees'),
      cell: (ticket) => (ticket.assignees.length === 0 ? <span className={styles.muted}>{t('columns.unassigned')}</span> : ticket.assignees.map((assignee) => assignee.name).join(', ')),
      width: '160px',
    },
    { key: 'status', header: t('columns.status'), cell: (ticket) => <TicketStatusBadge status={ticket.status} />, width: '120px', ...sortable('status') },
    { key: 'priority', header: t('columns.priority'), cell: (ticket) => nameOr(ticket.priority?.name), width: '120px', ...sortable('priority') },
    { key: 'workflowPriority', header: t('columns.workflowPriority'), cell: (ticket) => nameOr(ticket.workflowPriority?.name), width: '120px', ...sortable('workflowPriority') },
    { key: 'tags', header: t('columns.tags'), cell: (ticket) => <TicketTags tags={ticket.tags} />, width: '150px' },
    { key: 'lastActivity', header: t('columns.lastActivity'), cell: (ticket) => <span className={styles.date}>{formatShortDateTime(ticket.lastActivityAt, timeZone)}</span>, width: '150px', ...sortable('lastActivity') },
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

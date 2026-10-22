import type { TicketBatchGroup } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { ticketPath } from '@/shared/lib/paths';
import { Button, Card, Checkbox, Table, type TableColumn } from '@/shared/ui';
import { BatchAdvanceDialog } from './BatchAdvanceDialog';
import styles from './Batch.module.css';

type BatchTicket = TicketBatchGroup['tickets'][number];

/** One step's tickets with a box each, and its decisions for the ones chosen (up to the step's limit). */
export function BatchGroupCard({ group, timeZone }: { readonly group: TicketBatchGroup; readonly timeZone: string | undefined }) {
  const { t } = useTranslation('tickets');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [decision, setDecision] = useState<TicketBatchGroup['decisions'][number] | null>(null);
  // A ticket that left the group (moved here or elsewhere) is no longer chosen.
  const ids = group.tickets.map((ticket) => ticket.id).filter((id) => chosen.has(id));
  const all = ids.length === group.tickets.length;
  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const tooMany = ids.length > group.maxTickets;

  const columns: readonly TableColumn<BatchTicket>[] = [
    {
      key: 'pick',
      header: '',
      width: '44px',
      cell: (ticket) => <input type="checkbox" className={styles.box} aria-label={t('batch.pick', { number: ticket.number })} checked={chosen.has(ticket.id)} onChange={(event) => toggle(ticket.id, event.target.checked)} />,
    },
    { key: 'number', header: t('columns.number'), cell: (ticket) => ticket.number, code: true, width: '112px' },
    { key: 'title', header: t('columns.title'), cell: (ticket) => <Link to={ticketPath(ticket.id)}>{ticket.title}</Link> },
    { key: 'requester', header: t('batch.requester'), cell: (ticket) => ticket.requester.name },
    { key: 'company', header: t('batch.company'), cell: (ticket) => ticket.companyName },
    { key: 'due', header: t('batch.due'), cell: (ticket) => (ticket.dueAt === null ? '—' : formatDateTime(ticket.dueAt, timeZone)) },
  ];

  return (
    <Card title={t('batch.groupTitle', { step: group.stepName, workflow: group.workflowName })}>
      <div className={styles.stack}>
        <div className={styles.bar}>
          <Checkbox label={t('batch.all', { count: group.tickets.length })} checked={all} onChange={(event) => setChosen(event.target.checked ? new Set(group.tickets.map((ticket) => ticket.id)) : new Set())} />
          <span className={styles.note}>{t('batch.chosen', { count: ids.length, max: group.maxTickets })}</span>
        </div>
        <Table label={t('batch.tableLabel', { step: group.stepName })} columns={columns} rows={group.tickets} rowKey={(ticket) => ticket.id} empty={t('batch.emptyGroup')} />
        {tooMany && <p className={styles.error}>{t('batch.tooMany', { max: group.maxTickets })}</p>}
        <div className={styles.bar} role="group" aria-label={t('batch.decisions')}>
          {group.decisions.map((option) => (
            <Button key={option.transitionId} variant={group.decisions.length === 1 ? 'primary' : 'secondary'} disabled={ids.length === 0 || tooMany} onClick={() => setDecision(option)}>
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      {decision !== null && (
        <BatchAdvanceDialog
          group={group}
          ticketIds={ids}
          decision={decision}
          onClose={() => {
            setDecision(null);
            setChosen(new Set());
          }}
        />
      )}
    </Card>
  );
}

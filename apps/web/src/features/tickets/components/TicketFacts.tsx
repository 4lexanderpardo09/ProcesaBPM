import type { TicketDetailResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { type AssigneeSummary, assigneeSummary } from '../lib/assignee-summary';
import styles from './TicketFacts.module.css';

export interface TicketFactsProps {
  readonly ticket: TicketDetailResponse;
  /** The current step's name; `undefined` while the form loads. */
  readonly stepName: string | null | undefined;
  readonly userId: string | undefined;
  readonly timeZone: string | undefined;
}

/** The facts people look for first: when it was opened, where it is, who holds it and when it is due. */
export function TicketFacts({ ticket, stepName, userId, timeZone }: TicketFactsProps) {
  const { t } = useTranslation('tickets');
  const dueAt = ticket.openVisit?.dueAt ?? null;
  return (
    <dl className={styles.facts} aria-label={t('detail.facts.label')}>
      <Fact label={t('detail.facts.createdAt')} value={formatDateTime(ticket.createdAt, timeZone)} />
      {ticket.closedAt === null ? (
        <>
          <Fact label={t('detail.facts.step')} value={stepName === undefined ? '…' : (stepName ?? t('detail.noStep'))} />
          <AssigneesFact summary={assigneeSummary(ticket, userId)} />
          <Fact label={t('detail.facts.dueAt')} value={dueAt === null ? t('detail.noDueDate') : formatDateTime(dueAt, timeZone)} />
        </>
      ) : (
        <Fact label={t('detail.facts.closedAt')} value={formatDateTime(ticket.closedAt, timeZone)} />
      )}
    </dl>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className={styles.fact}>
      <dt className="text-overline">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function AssigneesFact({ summary }: { readonly summary: AssigneeSummary }) {
  const { t } = useTranslation('tickets');
  return <Fact label={t('detail.facts.assignees')} value={assigneeText()} />;

  function assigneeText(): string {
    switch (summary.kind) {
      case 'you':
        return summary.others === 0 ? t('detail.assignees.you') : t('detail.assignees.youAndOthers', { count: summary.others });
      case 'others':
        return t('detail.assignees.others', { count: summary.count });
      case 'awaitingDispatch':
        return t('detail.assignees.awaitingDispatch');
      case 'none':
        return t('detail.assignees.none');
    }
  }
}

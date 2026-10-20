import type { TicketDetailResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatShortDate } from '@/shared/lib/format-date-time';
import { type AssigneeSummary, assigneeSummary } from '../lib/assignee-summary';
import styles from './TicketFacts.module.css';

export interface TicketFactsProps {
  readonly ticket: TicketDetailResponse;
  readonly userId: string | undefined;
  readonly timeZone: string | undefined;
}

/** The facts people look for first: who asked, what about, for which company, where it is, who holds it and when it is due. */
export function TicketFacts({ ticket, userId, timeZone }: TicketFactsProps) {
  const { t } = useTranslation('tickets');
  const dueAt = ticket.sla?.dueAt ?? ticket.openVisit?.dueAt ?? null;
  const requester = ticket.registeredBy === null ? ticket.creator.name : t('detail.facts.registeredBy', { name: ticket.creator.name, by: ticket.registeredBy.name });
  return (
    <dl className={styles.facts} aria-label={t('detail.facts.label')}>
      <Fact label={t('detail.facts.requester')} value={requester} />
      <Fact label={t('detail.facts.category')} value={t('detail.facts.categoryPath', { category: ticket.subcategory.category.name, subcategory: ticket.subcategory.name })} />
      <Fact label={t('detail.facts.company')} value={ticket.company.name} />
      <Fact label={t('detail.facts.createdAt')} value={formatShortDate(ticket.createdAt, timeZone)} />
      {ticket.closedAt === null ? (
        <>
          <Fact label={t('detail.facts.step')} value={ticket.currentStep?.name ?? t('detail.noStep')} />
          <AssigneesFact summary={assigneeSummary(ticket, userId)} />
          <Fact label={t('detail.facts.dueAt')} value={dueAt === null ? t('detail.noDueDate') : formatDateTime(dueAt, timeZone)} />
        </>
      ) : (
        <Fact
          label={t('detail.facts.closedAt')}
          value={ticket.closedBy === null ? formatDateTime(ticket.closedAt, timeZone) : t('detail.facts.closedBy', { date: formatDateTime(ticket.closedAt, timeZone), name: ticket.closedBy.name })}
        />
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
      case 'people': {
        const names = summary.names.join(', ');
        return summary.more === 0 ? names : t('detail.assignees.andMore', { names, count: summary.more });
      }
      case 'awaitingDispatch':
        return t('detail.assignees.awaitingDispatch');
      case 'none':
        return t('detail.assignees.none');
    }
  }
}

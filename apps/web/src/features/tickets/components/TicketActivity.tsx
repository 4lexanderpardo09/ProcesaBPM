import type { TicketEventResponse } from '@procesabpm/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Avatar, Card, RichText } from '@/shared/ui';
import { CommentForm } from './CommentForm';
import { LoadError } from './LoadError';
import styles from './TicketActivity.module.css';

const EVENT_TYPES = [
  'CREATED',
  'TRANSITIONED',
  'ASSIGNED',
  'REASSIGNED',
  'COMMENTED',
  'INCIDENT_OPENED',
  'INCIDENT_RESOLVED',
  'CLOSED',
  'REOPENED',
  'ERROR_REPORTED',
  'AMOUNT_WARNING',
  'FIELDS_UPDATED',
  'SYSTEM',
  'PARALLEL_TASK_COMPLETED',
] as const;
type EventType = (typeof EVENT_TYPES)[number];

const eventTypeOf = (type: string): EventType => EVENT_TYPES.find((known) => known === type) ?? 'SYSTEM';

export interface TicketActivityProps {
  readonly ticketId: string;
  readonly timeline: UseQueryResult<readonly TicketEventResponse[]>;
  /** The comment box only shows to someone who may comment. */
  readonly canComment: boolean;
  readonly timeZone: string | undefined;
}

/** What happened on the ticket, oldest first, and a box to add a comment for whoever may. */
export function TicketActivity({ ticketId, timeline, canComment, timeZone }: TicketActivityProps) {
  const { t } = useTranslation('tickets');
  return (
    <Card title={t('detail.activity.title')}>
      {timeline.isError ? (
        <LoadError error={timeline.error} onRetry={() => void timeline.refetch()} />
      ) : timeline.data === undefined ? (
        <p className={styles.muted}>{t('detail.activity.loading')}</p>
      ) : timeline.data.length === 0 ? (
        <p className={styles.muted}>{t('detail.activity.empty')}</p>
      ) : (
        <ol className={styles.events}>
          {timeline.data.map((event) => (
            <ActivityEvent key={event.id} event={event} timeZone={timeZone} />
          ))}
        </ol>
      )}
      {canComment && (
        <div className={styles.comment}>
          <CommentForm ticketId={ticketId} />
        </div>
      )}
    </Card>
  );
}

interface ActivityEventProps {
  readonly event: TicketEventResponse;
  readonly timeZone: string | undefined;
}

/** Who did what, to whom, on which step and with which decision. */
function ActivityEvent({ event, timeZone }: ActivityEventProps) {
  const { t } = useTranslation('tickets');
  const actor = event.actor?.name ?? t('detail.activity.system');
  const type = eventTypeOf(event.type);
  const assignee = event.assignee !== null && (type === 'ASSIGNED' || type === 'REASSIGNED') ? ` ${t('detail.activity.toAssignee', { name: event.assignee.name })}` : '';
  const decision = event.transition !== null && event.transition.name !== '' ? ` ${t('detail.activity.decision', { name: event.transition.name })}` : '';
  return (
    <li className={styles.event}>
      <Avatar name={actor} />
      <div className={styles.eventBody}>
        <p className={styles.eventLine}>
          <strong>{actor}</strong> {t(`detail.events.${type}`)}
          {assignee}
          {decision}
          {event.step !== null && <> · {event.step.name}</>} · <time dateTime={event.createdAt}>{formatDateTime(event.createdAt, timeZone)}</time>
        </p>
        {event.commentHtml !== null && <RichText html={event.commentHtml} />}
      </div>
    </li>
  );
}

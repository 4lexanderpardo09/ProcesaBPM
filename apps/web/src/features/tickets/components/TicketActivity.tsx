import type { FormFieldResponse, TicketEventResponse, TicketValueNamesResponse } from '@procesabpm/shared';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { useApiClient } from '@/shared/session';
import { Avatar, Card, RichText } from '@/shared/ui';
import { prioritiesQueryOptions } from '../api/new-ticket-api';
import { type FieldChange, fieldChanges } from '../lib/field-changes';
import type { FieldValueDisplay } from '../lib/field-value';
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
  /** The fields of the ticket's version and the names its values point to, to read what a `FIELDS_UPDATED` changed. */
  readonly fields: readonly FormFieldResponse[];
  readonly valueNames: TicketValueNamesResponse;
}

/** What happened on the ticket, oldest first, and a box to add a comment for whoever may. */
export function TicketActivity({ ticketId, timeline, canComment, timeZone, fields, valueNames }: TicketActivityProps) {
  const { t } = useTranslation('tickets');
  const changesOf = (event: TicketEventResponse) => (event.type === 'FIELDS_UPDATED' ? fieldChanges(event.data, fields, valueNames, timeZone) : []);
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
            <ActivityEvent key={event.id} event={event} changes={changesOf(event)} timeZone={timeZone} />
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
  readonly changes: readonly FieldChange[];
  readonly timeZone: string | undefined;
}

/** Who did what, to whom, on which step and with which decision. */
function ActivityEvent({ event, changes, timeZone }: ActivityEventProps) {
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
        {changes.length > 0 && <ChangeList changes={changes} />}
        {event.commentHtml !== null && <RichText html={event.commentHtml} />}
      </div>
    </li>
  );
}

/** Each change as «what: before → after»; the description only says it changed, it would not fit in a line. */
function ChangeList({ changes }: { readonly changes: readonly FieldChange[] }) {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const priorities = useQuery({ ...prioritiesQueryOptions(client), enabled: changes.some((change) => change.kind === 'priority') });
  const priorityName = (priorityId: string | null) =>
    priorityId === null ? t('detail.changes.none') : (priorities.data?.find((priority) => priority.id === priorityId)?.name ?? t('detail.changes.otherPriority'));
  const valueText = (display: FieldValueDisplay | undefined): string => {
    if (display === undefined) return t('detail.changes.none');
    switch (display.kind) {
      case 'text':
        return display.text;
      case 'days':
        return t('detail.fields.days', { count: display.count });
      case 'rows':
        return t('detail.fields.rows', { count: display.count });
      case 'unknown':
        return t('detail.fields.unknown');
    }
  };
  const line = (change: FieldChange) => {
    switch (change.kind) {
      case 'title':
        return t('detail.changes.change', { label: t('detail.changes.title'), before: change.before, after: change.after });
      case 'description':
        return t('detail.changes.description');
      case 'priority':
        return t('detail.changes.change', { label: t('detail.changes.priority'), before: priorityName(change.before), after: priorityName(change.after) });
      case 'field':
        return t('detail.changes.change', { label: change.label, before: valueText(change.before), after: valueText(change.after) });
    }
  };
  return (
    <ul className={styles.changes}>
      {changes.map((change, index) => (
        // A change has no id of its own and the list never reorders.
        <li key={index}>{line(change)}</li>
      ))}
    </ul>
  );
}

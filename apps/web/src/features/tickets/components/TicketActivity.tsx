import type { FormFieldResponse, TicketDocumentResponse, TicketEventResponse, TicketValueNamesResponse } from '@procesabpm/shared';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { useApiClient } from '@/shared/session';
import { formatFileSize } from '@/shared/lib/format-file-size';
import { Alert, Avatar, Button, Card, DownloadIcon, RichText } from '@/shared/ui';
import { prioritiesQueryOptions } from '../api/new-ticket-api';
import { useTicketFileDownload } from '../hooks/use-ticket-file-download';
import { type FieldChange, fieldChanges } from '../lib/field-changes';
import type { FieldValueDisplay } from '../lib/field-value';
import { CommentForm } from './CommentForm';
import { LoadError } from './LoadError';
import { PdfViewerDialog } from './PdfViewerDialog';
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

/** The events that move the ticket or change who has it. */
const MOVEMENTS: ReadonlySet<EventType> = new Set(['CREATED', 'TRANSITIONED', 'ASSIGNED', 'REASSIGNED', 'CLOSED', 'REOPENED', 'PARALLEL_TASK_COMPLETED']);
const FILTERS = ['all', 'comments', 'movements', 'files'] as const;
type ActivityFilter = (typeof FILTERS)[number];

export interface TicketActivityProps {
  readonly ticketId: string;
  readonly timeline: UseQueryResult<readonly TicketEventResponse[]>;
  /** The comment box only shows to someone who may comment. */
  readonly canComment: boolean;
  readonly timeZone: string | undefined;
  /** The fields of the ticket's version and the names its values point to, to read what a `FIELDS_UPDATED` changed. */
  readonly fields: readonly FormFieldResponse[];
  readonly valueNames: TicketValueNamesResponse;
  /** The ticket's files: each event shows the ones attached with it (a comment's files, a step's, the closing documents). */
  readonly documents: readonly TicketDocumentResponse[];
}

/** What happened on the ticket, oldest first, with the files that came with each event, and a box to add a comment for whoever may. */
export function TicketActivity({ ticketId, timeline, canComment, timeZone, fields, valueNames, documents }: TicketActivityProps) {
  const { t } = useTranslation('tickets');
  const download = useTicketFileDownload(ticketId);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [viewing, setViewing] = useState<{ readonly id: string; readonly name: string } | undefined>(undefined);
  const changesOf = (event: TicketEventResponse) => (event.type === 'FIELDS_UPDATED' ? fieldChanges(event.data, fields, valueNames, timeZone) : []);
  const filesByEvent = new Map<string, TicketDocumentResponse[]>();
  for (const document of documents) {
    if (document.eventId !== null) filesByEvent.set(document.eventId, [...(filesByEvent.get(document.eventId) ?? []), document]);
  }
  const matches = (event: TicketEventResponse, which: ActivityFilter) => {
    switch (which) {
      case 'all':
        return true;
      case 'comments':
        return event.commentHtml !== null;
      case 'movements':
        return MOVEMENTS.has(eventTypeOf(event.type));
      case 'files':
        return filesByEvent.has(event.id);
    }
  };
  const shown = (timeline.data ?? []).filter((event) => matches(event, filter));
  return (
    <Card title={t('detail.activity.title')}>
      {timeline.isError ? (
        <LoadError error={timeline.error} onRetry={() => void timeline.refetch()} />
      ) : timeline.data === undefined ? (
        <p className={styles.muted}>{t('detail.activity.loading')}</p>
      ) : timeline.data.length === 0 ? (
        <p className={styles.muted}>{t('detail.activity.empty')}</p>
      ) : (
        <>
          <div className={styles.filters} role="group" aria-label={t('detail.activity.filters.label')} data-print="hide">
            {FILTERS.map((which) => (
              <button key={which} type="button" className={styles.filter} aria-pressed={filter === which} onClick={() => setFilter(which)}>
                {t(`detail.activity.filters.${which}`)} <span className={styles.filterCount}>{timeline.data.filter((event) => matches(event, which)).length}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className={styles.muted}>{t('detail.activity.filters.empty')}</p>
          ) : (
            <ol className={styles.events}>
              {shown.map((event) => (
                <ActivityEvent key={event.id} event={event} changes={changesOf(event)} files={filesByEvent.get(event.id) ?? []} downloading={download.isPending} onDownload={(fileId) => download.mutate(fileId)} onView={setViewing} timeZone={timeZone} />
              ))}
            </ol>
          )}
        </>
      )}
      {download.isError && <Alert tone="danger">{t('detail.attachments.downloadFailed')}</Alert>}
      {viewing !== undefined && <PdfViewerDialog ticketId={ticketId} file={viewing} onClose={() => setViewing(undefined)} />}
      {canComment && (
        <div className={styles.comment} data-print="hide">
          <CommentForm ticketId={ticketId} />
        </div>
      )}
    </Card>
  );
}

interface ActivityEventProps {
  readonly event: TicketEventResponse;
  readonly changes: readonly FieldChange[];
  readonly files: readonly TicketDocumentResponse[];
  readonly downloading: boolean;
  readonly onDownload: (fileId: string) => void;
  readonly onView: (file: { readonly id: string; readonly name: string }) => void;
  readonly timeZone: string | undefined;
}

/** Who did what, to whom, on which step and with which decision, and the files that came with it. */
function ActivityEvent({ event, changes, files, downloading, onDownload, onView, timeZone }: ActivityEventProps) {
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
          <strong>{actor}</strong> {addedSigner(event) ? t('detail.events.SIGNER_ADDED') : t(`detail.events.${type}`)}
          {assignee}
          {decision}
          {event.step !== null && <> · {event.step.name}</>} · <time dateTime={event.createdAt}>{formatDateTime(event.createdAt, timeZone)}</time>
        </p>
        {changes.length > 0 && <ChangeList changes={changes} />}
        {event.commentHtml !== null && <RichText html={event.commentHtml} />}
        {files.length > 0 && (
          <ul className={styles.files} aria-label={t('detail.activity.files')}>
            {files.map((document) => (
              <li key={document.id} className={styles.file}>
                <span className={styles.fileName}>{document.file.name}</span>
                <span className={styles.fileSize}>{formatFileSize(document.file.sizeBytes)}</span>
                {document.file.mimeType === 'application/pdf' && (
                  <Button variant="ghost" aria-label={t('detail.viewer.view', { name: document.file.name })} onClick={() => onView({ id: document.file.id, name: document.file.name })}>
                    {t('detail.attachments.view')}
                  </Button>
                )}
                <Button variant="ghost" icon={<DownloadIcon size={14} />} aria-label={t('detail.attachments.download', { name: document.file.name })} disabled={downloading} onClick={() => onDownload(document.file.id)} />
              </li>
            ))}
          </ul>
        )}
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

/** A reassignment that added one more signer to a parallel step instead of moving a signature. */
function addedSigner(event: TicketEventResponse): boolean {
  return event.type === 'REASSIGNED' && typeof event.data === 'object' && event.data !== null && (event.data as { addedSigner?: unknown }).addedSigner === true;
}

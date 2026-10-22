import type { EditTicketRequest, TicketDetailResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { htmlToPlainText, plainTextToHtml } from '@/shared/lib/plain-text-html';
import { useApiClient } from '@/shared/session';
import { Select, TextArea, TextField } from '@/shared/ui';
import { prioritiesQueryOptions } from '../../api/new-ticket-api';
import { editTicket } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from './ActionDialog';

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 20_000;

/**
 * Corrects what the ticket says: its subject, description and priority. Only what changed is sent, so editing the
 * subject never rewrites a description that held richer markup than the plain text shown here.
 */
export function EditTicketDialog({ ticket, onClose }: { readonly ticket: TicketDetailResponse; readonly onClose: () => void }) {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const originalDescription = htmlToPlainText(ticket.descriptionHtml);
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(originalDescription);
  const [priorityId, setPriorityId] = useState(ticket.priorityId ?? '');
  const [submitted, setSubmitted] = useState(false);
  const priorities = useQuery(prioritiesQueryOptions(client));
  const edit = useTicketMutation((c, body: EditTicketRequest) => editTicket(c, ticket.id, body));

  // A retired priority the ticket still carries stays in the list, so the dialog does not change it silently.
  const current = ticket.priority;
  const options = [
    ...(current !== null && !(priorities.data ?? []).some((priority) => priority.id === current.id) ? [{ value: current.id, label: current.name }] : []),
    ...(priorities.data ?? []).map((priority) => ({ value: priority.id, label: priority.name })),
  ];
  const changes: EditTicketRequest = {
    ...(title.trim() === ticket.title ? {} : { title: title.trim() }),
    ...(description.trim() === originalDescription ? {} : { description: description.trim() === '' ? '' : plainTextToHtml(description) }),
    ...(priorityId === (ticket.priorityId ?? '') ? {} : { priorityId: priorityId === '' ? null : priorityId }),
  };

  return (
    <ActionDialog
      open
      title={t('actions.edit.title')}
      submitLabel={t('actions.edit.submit')}
      pending={edit.isPending}
      error={edit.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (title.trim() === '') return;
        if (Object.keys(changes).length === 0) onClose();
        else edit.mutate(changes, { onSuccess: onClose });
      }}
    >
      <p>{t('actions.edit.body')}</p>
      <TextField
        label={t('actions.edit.subject')}
        required
        value={title}
        maxLength={TITLE_MAX}
        error={submitted && title.trim() === '' ? t('actions.edit.subjectRequired') : undefined}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Select
        label={t('actions.edit.priority')}
        value={priorityId}
        placeholder={priorities.isError ? t('actions.edit.prioritiesFailed') : t('actions.edit.noPriority')}
        options={options}
        onChange={(event) => setPriorityId(event.target.value)}
      />
      <TextArea label={t('actions.edit.description')} value={description} maxLength={DESCRIPTION_MAX} rows={6} onChange={(event) => setDescription(event.target.value)} />
    </ActionDialog>
  );
}

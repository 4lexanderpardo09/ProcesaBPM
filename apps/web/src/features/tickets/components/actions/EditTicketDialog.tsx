import { DESCRIPTION_HTML_MAX, type EditTicketRequest, type TicketDetailResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { isBlankRichText, RichTextEditor, Select, TextField } from '@/shared/ui';
import { prioritiesQueryOptions } from '../../api/new-ticket-api';
import { editTicket } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from './ActionDialog';

const TITLE_MAX = 300;

/**
 * Corrects what the ticket says: its subject, description and priority. Only what changed is sent: the editor reports
 * the description only once it is edited, so editing the subject never rewrites it.
 */
export function EditTicketDialog({ ticket, onClose }: { readonly ticket: TicketDetailResponse; readonly onClose: () => void }) {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.descriptionHtml);
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
    ...(description === ticket.descriptionHtml ? {} : { description: isBlankRichText(description) ? '' : description }),
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
      <RichTextEditor label={t('actions.edit.description')} value={description} maxLength={DESCRIPTION_HTML_MAX} minHeight={160} onValueChange={setDescription} />
    </ActionDialog>
  );
}

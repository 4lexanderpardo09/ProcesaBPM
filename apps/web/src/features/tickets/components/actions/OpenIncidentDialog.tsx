import { RICH_TEXT_MAX } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isBlankRichText, RichTextEditor } from '@/shared/ui';
import { openIncident } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from './ActionDialog';
import { PersonSelect } from './PersonSelect';

interface IncidentArgs {
  readonly assignedToId: string;
  readonly description: string;
}

/** Pauses the ticket (and its SLA) with a problem someone has to sort out first. */
export function OpenIncidentDialog({ ticketId, visitId, onClose }: { readonly ticketId: string; readonly visitId: string; readonly onClose: () => void }) {
  const { t } = useTranslation('tickets');
  const [assignedToId, setAssignedToId] = useState('');
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const incident = useTicketMutation((client, args: IncidentArgs) => openIncident(client, ticketId, { visitId, assignedToId: args.assignedToId, description: args.description }));
  const personMissing = submitted && assignedToId === '';
  const descriptionMissing = submitted && isBlankRichText(description);
  return (
    <ActionDialog
      open
      title={t('actions.incident.title')}
      submitLabel={t('actions.incident.submit')}
      pending={incident.isPending}
      error={incident.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (assignedToId !== '' && !isBlankRichText(description)) incident.mutate({ assignedToId, description }, { onSuccess: onClose });
      }}
    >
      <p>{t('actions.incident.body')}</p>
      <PersonSelect
        ticketId={ticketId}
        purpose="incident"
        label={t('actions.incident.person')}
        value={assignedToId}
        error={personMissing ? t('actions.incident.personRequired') : undefined}
        onChange={setAssignedToId}
      />
      <RichTextEditor
        label={t('actions.incident.description')}
        required
        value={description}
        maxLength={RICH_TEXT_MAX}
        error={descriptionMissing ? t('actions.incident.descriptionRequired') : undefined}
        onValueChange={setDescription}
      />
    </ActionDialog>
  );
}

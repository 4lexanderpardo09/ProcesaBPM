import { RICH_TEXT_MAX } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isBlankRichText, RichTextEditor } from '@/shared/ui';
import { reassignTicket } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from './ActionDialog';
import { PersonSelect } from './PersonSelect';

interface ReassignArgs {
  readonly toUserId: string;
  readonly comment: string;
}

/** Hands the current step to someone the step allows, with an optional note for the activity. */
export function ReassignDialog({ ticketId, visitId, onClose }: { readonly ticketId: string; readonly visitId: string; readonly onClose: () => void }) {
  const { t } = useTranslation('tickets');
  const [toUserId, setToUserId] = useState('');
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const reassign = useTicketMutation((client, args: ReassignArgs) =>
    reassignTicket(client, ticketId, { visitId, toUserId: args.toUserId, ...(isBlankRichText(args.comment) ? {} : { comment: args.comment }) }),
  );
  return (
    <ActionDialog
      open
      title={t('actions.reassign.title')}
      submitLabel={t('actions.reassign.submit')}
      pending={reassign.isPending}
      error={reassign.error}
      onClose={onClose}
      onSubmit={() => (toUserId === '' ? setMissing(true) : reassign.mutate({ toUserId, comment }, { onSuccess: onClose }))}
    >
      <PersonSelect
        ticketId={ticketId}
        purpose="reassign"
        label={t('actions.reassign.person')}
        value={toUserId}
        error={missing ? t('actions.reassign.personRequired') : undefined}
        onChange={(value) => {
          setToUserId(value);
          setMissing(false);
        }}
      />
      <RichTextEditor label={t('actions.optionalComment')} value={comment} maxLength={RICH_TEXT_MAX} onValueChange={setComment} />
    </ActionDialog>
  );
}

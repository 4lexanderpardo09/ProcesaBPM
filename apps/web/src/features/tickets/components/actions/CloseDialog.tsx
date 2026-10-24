import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isBlankRichText } from '@/shared/ui';
import { closeTicket } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { FilePicker } from '../advance/FileInput';
import { ResponseEditor } from '../ResponseEditor';
import { ActionDialog } from './ActionDialog';

interface CloseArgs {
  readonly comment: string;
  readonly attachments: readonly string[];
}

/** Closes the ticket from its current step, as the step's close rule allows, with an optional closing note and closing documents. */
export function CloseDialog({ ticketId, visitId, onClose }: { readonly ticketId: string; readonly visitId: string; readonly onClose: () => void }) {
  const { t } = useTranslation('tickets');
  const [comment, setComment] = useState('');
  const [attachments, setAttachments] = useState<readonly string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const close = useTicketMutation((client, args: CloseArgs) =>
    closeTicket(client, ticketId, { visitId, ...(isBlankRichText(args.comment) ? {} : { comment: args.comment }), attachments: args.attachments }),
  );
  return (
    <ActionDialog
      open
      title={t('actions.close.title')}
      submitLabel={t('actions.close.submit')}
      pending={close.isPending || attaching}
      error={close.error}
      onClose={onClose}
      onSubmit={() => close.mutate({ comment, attachments }, { onSuccess: onClose })}
    >
      <p>{t('actions.close.body')}</p>
      <ResponseEditor label={t('actions.optionalComment')} value={comment} onValueChange={setComment} />
      <FilePicker label={t('actions.closingAttachments')} required={false} value={attachments} knownNames={{}} error={undefined} onChange={setAttachments} onBusyChange={setAttaching} />
    </ActionDialog>
  );
}

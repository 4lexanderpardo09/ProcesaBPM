import { RICH_TEXT_MAX } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isBlankRichText, RichTextEditor } from '@/shared/ui';
import { closeTicket } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from './ActionDialog';

/** Closes the ticket from its current step, as the step's close rule allows, with an optional closing note. */
export function CloseDialog({ ticketId, visitId, onClose }: { readonly ticketId: string; readonly visitId: string; readonly onClose: () => void }) {
  const { t } = useTranslation('tickets');
  const [comment, setComment] = useState('');
  const close = useTicketMutation((client, text: string) => closeTicket(client, ticketId, { visitId, ...(isBlankRichText(text) ? {} : { comment: text }) }));
  return (
    <ActionDialog
      open
      title={t('actions.close.title')}
      submitLabel={t('actions.close.submit')}
      pending={close.isPending}
      error={close.error}
      onClose={onClose}
      onSubmit={() => close.mutate(comment, { onSuccess: onClose })}
    >
      <p>{t('actions.close.body')}</p>
      <RichTextEditor label={t('actions.optionalComment')} value={comment} maxLength={RICH_TEXT_MAX} onValueChange={setComment} />
    </ActionDialog>
  );
}

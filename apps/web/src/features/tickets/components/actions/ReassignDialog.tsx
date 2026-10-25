import { RICH_TEXT_MAX, type TicketDetailResponse } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isBlankRichText, RichTextEditor, Select } from '@/shared/ui';
import { reassignTicket } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from './ActionDialog';
import { PersonSelect } from './PersonSelect';

/** The choice that adds one more signer instead of moving a pending signature. */
const ADD_SIGNER = 'add';

interface ReassignArgs {
  readonly toUserId: string;
  readonly comment: string;
  /** On a parallel step: whose pending signature moves, or `ADD_SIGNER`. */
  readonly signature: string | undefined;
}

export interface ReassignDialogProps {
  readonly ticketId: string;
  readonly visitId: string;
  /** The signatures of the current parallel step (empty on any other step). */
  readonly signatures: TicketDetailResponse['parallelTasks'];
  readonly onClose: () => void;
}

/**
 * Hands the current step to someone the step allows, with an optional note for the activity. On a parallel step, as in
 * the help desk, it either moves one pending signature to someone else or adds one more signer to the step.
 */
export function ReassignDialog({ ticketId, visitId, signatures, onClose }: ReassignDialogProps) {
  const { t } = useTranslation('tickets');
  const pending = signatures.filter((signature) => signature.status === 'PENDING');
  const parallel = signatures.length > 0;
  const [signature, setSignature] = useState(pending[0]?.userId ?? ADD_SIGNER);
  const [toUserId, setToUserId] = useState('');
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const reassign = useTicketMutation((client, args: ReassignArgs) =>
    reassignTicket(client, ticketId, {
      visitId,
      toUserId: args.toUserId,
      ...(isBlankRichText(args.comment) ? {} : { comment: args.comment }),
      ...(args.signature === undefined ? {} : args.signature === ADD_SIGNER ? { addSigner: true } : { fromUserId: args.signature }),
    }),
  );
  const adding = parallel && signature === ADD_SIGNER;
  return (
    <ActionDialog
      open
      title={t('actions.reassign.title')}
      submitLabel={adding ? t('actions.reassign.addSubmit') : t('actions.reassign.submit')}
      pending={reassign.isPending}
      error={reassign.error}
      onClose={onClose}
      onSubmit={() => (toUserId === '' ? setMissing(true) : reassign.mutate({ toUserId, comment, signature: parallel ? signature : undefined }, { onSuccess: onClose }))}
    >
      {parallel && (
        <Select
          label={t('actions.reassign.signature')}
          required
          value={signature}
          options={[
            ...pending.map((task) => ({ value: task.userId, label: t('actions.reassign.moveSignature', { name: task.name }) })),
            { value: ADD_SIGNER, label: t('actions.reassign.addSigner') },
          ]}
          onChange={(event) => setSignature(event.target.value)}
        />
      )}
      <PersonSelect
        ticketId={ticketId}
        purpose="reassign"
        label={adding ? t('actions.reassign.newSigner') : t('actions.reassign.person')}
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

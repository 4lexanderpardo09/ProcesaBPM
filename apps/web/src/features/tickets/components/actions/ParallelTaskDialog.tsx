import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { plainTextToHtml } from '@/shared/lib/plain-text-html';
import { TextArea } from '@/shared/ui';
import { answerParallelTask } from '../../api/ticket-actions-api';
import { useNextAssignee } from '../../hooks/use-next-assignee';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from './ActionDialog';
import { NextAssigneeField } from './NextAssigneeField';
import { SignatureChoice, useSignatureChoice } from './SignatureChoice';

export type ParallelAnswer = 'sign' | 'reject';

export interface ParallelTaskDialogProps {
  readonly ticketId: string;
  readonly visitId: string;
  readonly answer: ParallelAnswer;
  readonly onClose: () => void;
}

interface AnswerArgs {
  readonly comment: string;
  readonly assigneeId: string | undefined;
}

/**
 * The caller's own signature on a parallel step: signing takes an optional note, rejecting asks why (the others who sign
 * and whoever gets the ticket back need the reason). The last signature can move the ticket on, so it may ask who is next.
 */
export function ParallelTaskDialog({ ticketId, visitId, answer, onClose }: ParallelTaskDialogProps) {
  const { t } = useTranslation('tickets');
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const next = useNextAssignee();
  const signature = useSignatureChoice();
  const send = useTicketMutation((client, args: AnswerArgs) =>
    answerParallelTask(client, ticketId, answer, {
      visitId,
      ...(args.comment.trim() === '' ? {} : { comment: plainTextToHtml(args.comment) }),
      ...(args.assigneeId === undefined ? {} : { assigneeId: args.assigneeId }),
      ...(answer === 'sign' && signature.fileId !== undefined ? { signatureFileId: signature.fileId } : {}),
    }),
  );
  const reasonMissing = answer === 'reject' && submitted && comment.trim() === '';
  return (
    <ActionDialog
      open
      title={t(`actions.parallel.${answer}.title`)}
      submitLabel={t(`actions.parallel.${answer}.submit`)}
      pending={send.isPending}
      error={next.shownError(send.error)}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        const assignee = next.request();
        if (answer === 'sign' && signature.missing) return;
        if (assignee.ok && !(answer === 'reject' && comment.trim() === '')) send.mutate({ comment, assigneeId: assignee.assigneeId }, { onSuccess: onClose, onError: next.onError });
      }}
    >
      <p>{t(`actions.parallel.${answer}.body`)}</p>
      <TextArea
        label={answer === 'reject' ? t('actions.parallel.reject.reason') : t('actions.optionalComment')}
        required={answer === 'reject'}
        value={comment}
        maxLength={5000}
        rows={3}
        error={reasonMissing ? t('actions.parallel.reject.reasonRequired') : undefined}
        onChange={(event) => setComment(event.target.value)}
      />
      {answer === 'sign' && <SignatureChoice choice={signature} showMissing={submitted} />}
      <NextAssigneeField next={next} />
    </ActionDialog>
  );
}

import { RICH_TEXT_MAX, type SignerChoices } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { isBlankRichText, RichTextEditor } from '@/shared/ui';
import { answerParallelTask, previewParallelSign } from '../../api/ticket-actions-api';
import { useNextAssignee } from '../../hooks/use-next-assignee';
import { choicesOfPreview } from '../../hooks/use-next-step-preview';
import { useSignerChoices } from '../../hooks/use-signer-choices';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { NextStepSummary } from '../next-step/NextStepSummary';
import { ActionDialog } from './ActionDialog';
import { NextAssigneeField } from './NextAssigneeField';
import { SignatureChoice, useSignatureChoice } from './SignatureChoice';
import { SignerChoicesField } from './SignerChoicesField';

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
  readonly signerChoices: SignerChoices | undefined;
}

/**
 * The caller's own signature on a parallel step: signing takes an optional note, rejecting asks why (the others who sign
 * and whoever gets the ticket back need the reason). The last signature moves the ticket on: before signing it says
 * where to, and asks who is next or who signs for the next step's signers when that step needs it.
 */
export function ParallelTaskDialog({ ticketId, visitId, answer, onClose }: ParallelTaskDialogProps) {
  const { t } = useTranslation('tickets');
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const client = useApiClient();
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const preview = useQuery({ queryKey: ['tickets', 'sign-preview', ticketId, visitId], queryFn: () => previewParallelSign(client, ticketId, visitId), enabled: answer === 'sign', retry: false });
  const following = preview.data?.next ?? undefined;
  const next = useNextAssignee(choicesOfPreview(following));
  const signers = useSignerChoices(following?.signerChoices);
  const signature = useSignatureChoice();
  const send = useTicketMutation((client, args: AnswerArgs) =>
    answerParallelTask(client, ticketId, answer, {
      visitId,
      ...(isBlankRichText(args.comment) ? {} : { comment: args.comment }),
      ...(args.assigneeId === undefined ? {} : { assigneeId: args.assigneeId }),
      ...(args.signerChoices === undefined ? {} : { signerChoices: args.signerChoices }),
      ...(answer === 'sign' && signature.fileId !== undefined ? { signatureFileId: signature.fileId } : {}),
    }),
  );
  const reasonMissing = answer === 'reject' && submitted && isBlankRichText(comment);
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
        const signing = answer === 'sign' ? signers.request() : { ok: true as const };
        if (answer === 'sign' && signature.missing) return;
        if (assignee.ok && signing.ok && !(answer === 'reject' && isBlankRichText(comment)))
          send.mutate({ comment, assigneeId: assignee.assigneeId, signerChoices: signing.ok ? signing.signerChoices : undefined }, { onSuccess: onClose, onError: next.onError });
      }}
    >
      <p>{t(`actions.parallel.${answer}.body`)}</p>
      <RichTextEditor
        label={answer === 'reject' ? t('actions.parallel.reject.reason') : t('actions.optionalComment')}
        required={answer === 'reject'}
        value={comment}
        maxLength={RICH_TEXT_MAX}
        error={reasonMissing ? t('actions.parallel.reject.reasonRequired') : undefined}
        onValueChange={setComment}
      />
      {answer === 'sign' && <SignatureChoice choice={signature} showMissing={submitted} />}
      {answer === 'sign' && preview.data?.last === true && <NextStepSummary preview={following} loading={preview.isFetching} failed={preview.isError} timeZone={timeZone} />}
      <NextAssigneeField next={next} />
      {answer === 'sign' && <SignerChoicesField choices={signers} />}
    </ActionDialog>
  );
}

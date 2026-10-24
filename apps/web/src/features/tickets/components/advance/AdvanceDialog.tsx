import type { FormDecisionResponse, TicketDetailResponse, TicketFormResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { plainTextToHtml } from '@/shared/lib/plain-text-html';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { TextArea } from '@/shared/ui';
import { previewTransition, transitionTicket } from '../../api/ticket-actions-api';
import { ticketDocumentsQueryOptions } from '../../api/ticket-detail-api';
import { useNextAssignee } from '../../hooks/use-next-assignee';
import { choicesOfPreview, useNextStepPreview } from '../../hooks/use-next-step-preview';
import { typedFields, useStepFields } from '../../hooks/use-step-fields';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from '../actions/ActionDialog';
import { NextAssigneeField } from '../actions/NextAssigneeField';
import { SignatureChoice, useSignatureChoice } from '../actions/SignatureChoice';
import { NextStepSummary } from '../next-step/NextStepSummary';
import styles from './AdvanceDialog.module.css';
import { StepFieldInput } from './StepFieldInput';

export interface AdvanceDialogProps {
  readonly ticket: TicketDetailResponse;
  readonly form: TicketFormResponse;
  readonly visitId: string;
  readonly decision: FormDecisionResponse;
  readonly onClose: () => void;
}

interface AdvanceArgs {
  readonly values: Record<string, unknown>;
  readonly comment: string;
  readonly assigneeId: string | undefined;
}

/**
 * Answers the step with one of its decisions: the fields captured on this step, and an optional note. Before sending,
 * it says what follows (the next step, who gets it, what is filled there, or that the ticket ends or cannot go on) and,
 * when the next step needs its assignee chosen, asks for that person among its candidates.
 */
export function AdvanceDialog({ ticket, form, visitId, decision, onClose }: AdvanceDialogProps) {
  const { t } = useTranslation('tickets');
  const editable = new Set(form.editableFieldCodes);
  const fields = typedFields(form.fields.filter((field) => editable.has(field.code)));
  const [comment, setComment] = useState('');
  const client = useApiClient();
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  // A signature step is signed: with the profile signature, or one drawn now.
  const signs = form.step?.type === 'SIGNATURE';
  const signature = useSignatureChoice();
  const [submitted, setSubmitted] = useState(false);
  const documents = useQuery(ticketDocumentsQueryOptions(client, ticket.id));
  const knownFiles = Object.fromEntries((documents.data ?? []).map((document) => [document.file.id, document.file.name]));
  const knownLabels = Object.assign({}, ...Object.values(ticket.valueNames)) as Record<string, string>;
  const advance = useTicketMutation((client, args: AdvanceArgs) =>
    transitionTicket(client, ticket.id, {
      transitionId: decision.transitionId,
      visitId,
      values: args.values,
      ...(args.comment.trim() === '' ? {} : { comment: plainTextToHtml(args.comment) }),
      ...(args.assigneeId === undefined ? {} : { assigneeId: args.assigneeId }),
      ...(signs && signature.fileId !== undefined ? { signatureFileId: signature.fileId } : {}),
    }),
  );
  const stepFields = useStepFields(fields, ticket.values, advance.error);
  const preview = useNextStepPreview([ticket.id, visitId, decision.transitionId], stepFields.draft(), (values) => previewTransition(client, ticket.id, { transitionId: decision.transitionId, visitId, values: { ...values } }));
  const next = useNextAssignee(choicesOfPreview(preview.data));

  const submit = () => {
    setSubmitted(true);
    if (signs && signature.missing) return;
    const collected = stepFields.collect();
    const assignee = next.request();
    if (collected.ok && assignee.ok) advance.mutate({ values: collected.values, comment, assigneeId: assignee.assigneeId }, { onSuccess: onClose, onError: next.onError });
  };

  return (
    <ActionDialog
      open
      title={t('advance.title', { decision: decision.label })}
      submitLabel={decision.label}
      pending={advance.isPending || stepFields.busy}
      error={stepFields.rejected ? null : next.shownError(advance.error)}
      onClose={onClose}
      onSubmit={submit}
    >
      {form.step !== null && <p className={styles.step}>{t('advance.step', { step: form.step.name })}</p>}
      {stepFields.rejected && <p className={styles.summary}>{t('advance.fixFields')}</p>}
      {fields.map((field) => (
        <StepFieldInput key={field.id} field={field} knownLabels={knownLabels} knownFiles={knownFiles} {...stepFields.inputProps(field)} />
      ))}
      <TextArea label={t('actions.optionalComment')} value={comment} maxLength={5000} rows={3} onChange={(event) => setComment(event.target.value)} />
      {signs && <SignatureChoice choice={signature} showMissing={submitted} />}
      <NextStepSummary preview={preview.data} loading={preview.isFetching} failed={preview.isError} timeZone={timeZone} />
      <NextAssigneeField next={next} />
    </ActionDialog>
  );
}

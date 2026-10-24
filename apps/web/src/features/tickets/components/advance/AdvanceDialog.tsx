import { type FormDecisionResponse, type TicketDetailResponse, type TicketFormResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { textAsHtml } from '@/shared/lib/text-as-html';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { isBlankRichText } from '@/shared/ui';
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
import { ResponseEditor } from '../ResponseEditor';
import styles from './AdvanceDialog.module.css';
import { FilePicker } from './FileInput';
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
  readonly attachments: readonly string[];
  readonly assigneeId: string | undefined;
}

/**
 * Answers the step with one of its decisions: the fields captured on this step, an optional note (it starts with the
 * step's instructions, to complete or clear: they are not sent untouched) and loose files. Before sending,
 * it says what follows (the next step, who gets it, what is filled there, or that the ticket ends or cannot go on) and,
 * when the next step needs its assignee chosen, asks for that person among its candidates.
 */
export function AdvanceDialog({ ticket, form, visitId, decision, onClose }: AdvanceDialogProps) {
  const { t } = useTranslation('tickets');
  const editable = new Set(form.editableFieldCodes);
  const fields = typedFields(form.fields.filter((field) => editable.has(field.code)));
  const instructions = textAsHtml(form.step?.description ?? '');
  const [comment, setComment] = useState(instructions);
  const [untouched, setUntouched] = useState(false);
  const [attachments, setAttachments] = useState<readonly string[]>([]);
  const [attaching, setAttaching] = useState(false);
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
      ...(isBlankRichText(args.comment) ? {} : { comment: args.comment }),
      attachments: args.attachments,
      ...(args.assigneeId === undefined ? {} : { assigneeId: args.assigneeId }),
      ...(signs && signature.fileId !== undefined ? { signatureFileId: signature.fileId } : {}),
    }),
  );
  const stepFields = useStepFields(fields, ticket.values, advance.error);
  const preview = useNextStepPreview([ticket.id, visitId, decision.transitionId], stepFields.draft(), (values) => previewTransition(client, ticket.id, { transitionId: decision.transitionId, visitId, values: { ...values } }));
  const next = useNextAssignee(choicesOfPreview(preview.data));

  const submit = () => {
    setSubmitted(true);
    // As in the help desk: the preloaded instructions are a guide to answer, not the answer.
    const unchanged = !isBlankRichText(instructions) && plainText(comment) === plainText(instructions);
    setUntouched(unchanged);
    if (unchanged || (signs && signature.missing)) return;
    const collected = stepFields.collect();
    const assignee = next.request();
    if (collected.ok && assignee.ok) advance.mutate({ values: collected.values, comment, attachments, assigneeId: assignee.assigneeId }, { onSuccess: onClose, onError: next.onError });
  };

  return (
    <ActionDialog
      open
      title={t('advance.title', { decision: decision.label })}
      submitLabel={decision.label}
      pending={advance.isPending || stepFields.busy || attaching}
      error={stepFields.rejected ? null : next.shownError(advance.error)}
      onClose={onClose}
      onSubmit={submit}
      size="wide"
    >
      {form.step !== null && <p className={styles.step}>{t('advance.step', { step: form.step.name })}</p>}
      {stepFields.rejected && <p className={styles.summary}>{t('advance.fixFields')}</p>}
      {fields.map((field) => (
        <StepFieldInput key={field.id} field={field} knownLabels={knownLabels} knownFiles={knownFiles} {...stepFields.inputProps(field)} />
      ))}
      <ResponseEditor
        label={t('actions.optionalComment')}
        value={comment}
        minHeight={180}
        error={untouched ? t('actions.untouchedInstructions') : undefined}
        onValueChange={(next) => {
          setComment(next);
          setUntouched(false);
        }}
      />
      <FilePicker label={t('actions.attachments')} required={false} value={attachments} knownNames={knownFiles} error={undefined} onChange={setAttachments} onBusyChange={setAttaching} />
      {signs && <SignatureChoice choice={signature} showMissing={submitted} />}
      <NextStepSummary preview={preview.data} loading={preview.isFetching} failed={preview.isError} timeZone={timeZone} />
      <NextAssigneeField next={next} />
    </ActionDialog>
  );
}

/** The words of the HTML, without its markup or spacing: the instructions count as untouched even if the editor rewrote their tags. */
function plainText(html: string): string {
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

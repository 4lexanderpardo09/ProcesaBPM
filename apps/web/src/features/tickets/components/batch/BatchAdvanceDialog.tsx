import { type BatchTransitionResult, holdsFiles, type TicketBatchGroup, RICH_TEXT_MAX } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Alert, isBlankRichText, RichTextEditor } from '@/shared/ui';
import { runTicketBatch } from '../../api/batch-api';
import { ticketFormQueryOptions } from '../../api/ticket-detail-api';
import { typedFields, useStepFields } from '../../hooks/use-step-fields';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from '../actions/ActionDialog';
import { StepFieldInput } from '../advance/StepFieldInput';
import styles from './Batch.module.css';

/** The API's reason for one ticket, as a text of the `tickets` namespace. */
const REASONS = {
  FIELD_VALUES_INVALID: 'batch.reasons.fields',
  PERMISSION_DENIED: 'batch.reasons.notHeld',
  ASSIGNEE_SELECTION_REQUIRED: 'batch.reasons.chooseAssignee',
  NO_ASSIGNEE_CANDIDATES: 'batch.reasons.noCandidates',
  AMOUNT_LIMIT_EXCEEDED: 'batch.reasons.amount',
} as const;
type Reason = (typeof REASONS)[keyof typeof REASONS] | 'batch.reasons.other';
const reasonOf = (code: string): Reason => (REASONS as Readonly<Record<string, Reason>>)[code] ?? 'batch.reasons.other';

export interface BatchAdvanceDialogProps {
  readonly group: TicketBatchGroup;
  readonly ticketIds: readonly string[];
  readonly decision: TicketBatchGroup['decisions'][number];
  readonly onClose: () => void;
}

/**
 * The step's fields once for every chosen ticket, and an optional note that each ticket keeps as its own. The form is
 * the one of the first ticket (all are on the same step of the same version); file fields are left for one by one,
 * since a file belongs to a single ticket. After sending, it lists what moved and what stayed, and why.
 */
export function BatchAdvanceDialog({ group, ticketIds, decision, onClose }: BatchAdvanceDialogProps) {
  const { t } = useTranslation('tickets');
  const form = useQuery(ticketFormQueryOptions(useApiClient(), ticketIds[0]!));
  const editable = new Set(form.data?.editableFieldCodes ?? []);
  const fields = typedFields((form.data?.fields ?? []).filter((field) => editable.has(field.code) && !holdsFiles(field)));
  if (form.data === undefined) {
    return (
      <ActionDialog open title={t('batch.dialogTitle', { decision: decision.label, count: ticketIds.length })} submitLabel={decision.label} pending error={null} onClose={onClose} onSubmit={() => undefined}>
        <p className={styles.note}>{form.isError ? t('batch.formFailed') : t('detail.loading')}</p>
      </ActionDialog>
    );
  }
  return <BatchForm group={group} ticketIds={ticketIds} decision={decision} fields={fields} onClose={onClose} />;
}

function BatchForm({ group, ticketIds, decision, fields, onClose }: BatchAdvanceDialogProps & { readonly fields: ReturnType<typeof typedFields> }) {
  const { t } = useTranslation('tickets');
  const [comment, setComment] = useState('');
  const [commentMissing, setCommentMissing] = useState(false);
  const [results, setResults] = useState<readonly BatchTransitionResult[] | null>(null);
  const run = useTicketMutation((client, values: Record<string, unknown>) =>
    runTicketBatch(client, {
      transitionId: decision.transitionId,
      items: group.tickets.filter((ticket) => ticketIds.includes(ticket.id)).map((ticket) => ({ ticketId: ticket.id, visitId: ticket.visitId })),
      values,
      ...(isBlankRichText(comment) ? {} : { comment: comment }),
    }),
  );
  const stepFields = useStepFields(fields, {}, null);
  const numberOf = (ticketId: string) => group.tickets.find((ticket) => ticket.id === ticketId)?.number ?? '';

  if (results !== null) {
    const moved = results.filter((result) => result.ok).length;
    const failed = results.flatMap((result) => (result.ok ? [] : [result]));
    return (
      <ActionDialog open title={t('batch.resultTitle')} submitLabel={t('batch.done')} pending={false} error={null} onClose={onClose} onSubmit={onClose}>
        {moved > 0 && <Alert tone="ok">{t('batch.moved', { count: moved })}</Alert>}
        {failed.length > 0 && (
          <Alert tone="warn" title={t('batch.failed', { count: failed.length })}>
            <ul className={styles.reasons}>
              {failed.map((result) => (
                <li key={result.ticketId}>
                  <strong>{numberOf(result.ticketId)}</strong> · {t(reasonOf(result.error.code))}
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </ActionDialog>
    );
  }

  return (
    <ActionDialog
      open
      title={t('batch.dialogTitle', { decision: decision.label, count: ticketIds.length })}
      submitLabel={decision.label}
      pending={run.isPending || stepFields.busy}
      error={run.error}
      onClose={onClose}
      onSubmit={() => {
        const missing = decision.requiresComment && isBlankRichText(comment);
        setCommentMissing(missing);
        const collected = stepFields.collect();
        if (collected.ok && !missing) run.mutate(collected.values, { onSuccess: (answer) => setResults(answer.results) });
      }}
    >
      <p className={styles.note}>{t('batch.dialogBody', { step: group.stepName })}</p>
      {fields.map((field) => (
        <StepFieldInput key={field.id} field={field} knownLabels={{}} knownFiles={{}} {...stepFields.inputProps(field)} />
      ))}
      <RichTextEditor
        label={t(decision.requiresComment ? 'actions.requiredComment' : 'actions.optionalComment')}
        value={comment}
        maxLength={RICH_TEXT_MAX}
        error={commentMissing ? t('actions.commentRequired') : undefined}
        onValueChange={(next) => {
          setComment(next);
          setCommentMissing(false);
        }}
      />
    </ActionDialog>
  );
}

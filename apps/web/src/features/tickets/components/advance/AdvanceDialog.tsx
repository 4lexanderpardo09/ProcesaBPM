import type { FormDecisionResponse, FormFieldResponse, TicketDetailResponse, TicketFormResponse } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { plainTextToHtml } from '@/shared/lib/plain-text-html';
import { TextArea } from '@/shared/ui';
import { transitionTicket } from '../../api/ticket-actions-api';
import { useNextAssignee } from '../../hooks/use-next-assignee';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { type FieldIssueKey, fieldIssuesOf } from '../../lib/field-issues';
import { initialInput, type InputValue, isBlankInput, isCapturable, requestValue } from '../../lib/step-values';
import { ActionDialog } from '../actions/ActionDialog';
import { NextAssigneeField } from '../actions/NextAssigneeField';
import styles from './AdvanceDialog.module.css';
import { StepFieldInput } from './StepFieldInput';

export interface AdvanceDialogProps {
  readonly ticket: TicketDetailResponse;
  readonly form: TicketFormResponse;
  readonly visitId: string;
  readonly decision: FormDecisionResponse;
  readonly onClose: () => void;
}

type Issue = FieldIssueKey | 'NOT_CAPTURABLE';

interface AdvanceArgs {
  readonly values: Record<string, unknown>;
  readonly comment: string;
  readonly assigneeId: string | undefined;
}

/**
 * Answers the step with one of its decisions: the fields captured on this step, and an optional note. When the next step
 * needs its assignee chosen, the API says so and the dialog asks for that person before trying again.
 */
export function AdvanceDialog({ ticket, form, visitId, decision, onClose }: AdvanceDialogProps) {
  const { t } = useTranslation('tickets');
  const fields = editableFields(form);
  const [inputs, setInputs] = useState<Record<string, InputValue>>(() => Object.fromEntries(fields.map((field) => [field.code, initialInput(field, ticket.values[field.code])])));
  const [comment, setComment] = useState('');
  const [localIssues, setLocalIssues] = useState<ReadonlyMap<string, Issue>>(new Map());
  const next = useNextAssignee();
  const advance = useTicketMutation((client, args: AdvanceArgs) =>
    transitionTicket(client, ticket.id, {
      transitionId: decision.transitionId,
      visitId,
      values: args.values,
      ...(args.comment.trim() === '' ? {} : { comment: plainTextToHtml(args.comment) }),
      ...(args.assigneeId === undefined ? {} : { assigneeId: args.assigneeId }),
    }),
  );
  const serverIssues = fieldIssuesOf(advance.error);
  const issueOf = (code: string): Issue | undefined => localIssues.get(code) ?? serverIssues?.get(code);

  const submit = () => {
    const issues = new Map<string, Issue>();
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      const input = inputs[field.code] ?? '';
      if (!isCapturable(field)) {
        if (field.isRequired && isBlankValue(ticket.values[field.code])) issues.set(field.code, 'NOT_CAPTURABLE');
        continue;
      }
      if (field.isRequired && isBlankInput(input)) issues.set(field.code, 'REQUIRED');
      const value = requestValue(field, input);
      if (value.ok) values[field.code] = value.value;
      else issues.set(field.code, 'INVALID_TYPE');
    }
    setLocalIssues(issues);
    const assignee = next.request();
    if (issues.size === 0 && assignee.ok) advance.mutate({ values, comment, assigneeId: assignee.assigneeId }, { onSuccess: onClose, onError: next.onError });
  };

  return (
    <ActionDialog
      open
      title={t('advance.title', { decision: decision.label })}
      submitLabel={decision.label}
      pending={advance.isPending}
      error={serverIssues === undefined ? next.shownError(advance.error) : null}
      onClose={onClose}
      onSubmit={submit}
    >
      {form.step !== null && <p className={styles.step}>{t('advance.step', { step: form.step.name })}</p>}
      {serverIssues !== undefined && serverIssues.size > 0 && <p className={styles.summary}>{t('advance.fixFields')}</p>}
      {fields.map((field) => {
        const issue = issueOf(field.code);
        return (
          <StepFieldInput
            key={field.id}
            field={field}
            value={inputs[field.code] ?? ''}
            error={issue === undefined ? undefined : t(`advance.issues.${issue}`)}
            onChange={(value) => {
              setInputs((current) => ({ ...current, [field.code]: value }));
              setLocalIssues((current) => withoutIssue(current, field.code));
            }}
          />
        );
      })}
      <TextArea label={t('actions.optionalComment')} value={comment} maxLength={5000} rows={3} onChange={(event) => setComment(event.target.value)} />
      <NextAssigneeField next={next} />
    </ActionDialog>
  );
}

/** The fields captured on this step that a person fills (computed ones are not typed), in the builder's order. */
function editableFields(form: TicketFormResponse): readonly FormFieldResponse[] {
  const editable = new Set(form.editableFieldCodes);
  return form.fields.filter((field) => editable.has(field.code) && !field.isReadOnly && field.type !== 'FORMULA' && field.type !== 'CALCULATOR').sort((left, right) => left.sortOrder - right.sortOrder);
}

function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function withoutIssue(issues: ReadonlyMap<string, Issue>, code: string): ReadonlyMap<string, Issue> {
  if (!issues.has(code)) return issues;
  const next = new Map(issues);
  next.delete(code);
  return next;
}

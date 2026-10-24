import { type CreationFormStart, DESCRIPTION_HTML_MAX } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { paths, ticketPath } from '@/shared/lib/paths';
import { textAsHtml } from '@/shared/lib/text-as-html';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { Button, ButtonLink, Card, isBlankRichText, RichText, RichTextEditor, TextField } from '@/shared/ui';
import { createTicket, previewCreation } from '../../api/new-ticket-api';
import { useNextAssignee } from '../../hooks/use-next-assignee';
import { choicesOfPreview, useNextStepPreview } from '../../hooks/use-next-step-preview';
import { typedFields, useStepFields } from '../../hooks/use-step-fields';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { NextAssigneeField } from '../actions/NextAssigneeField';
import { FilePicker } from '../advance/FileInput';
import { StepFieldInput } from '../advance/StepFieldInput';
import { NextStepSummary } from '../next-step/NextStepSummary';
import { CreationError } from './CreationError';
import { SectionTitle } from './RequestTypeCard';
import styles from './NewTicket.module.css';

const TITLE_MAX = 300;

export interface RequestFormProps {
  readonly subcategoryId: string;
  readonly companyId: string;
  /** The person the ticket is for, when it is not the caller (`create_for_others`). */
  readonly requesterId?: string | undefined;
  /** `undefined` keeps the subcategory's default priority. */
  readonly priorityId: string | undefined;
  readonly start: CreationFormStart;
}

interface CreateArgs {
  readonly title: string;
  readonly description: string;
  readonly values: Record<string, unknown>;
  readonly attachments: readonly string[];
  readonly assigneeId: string | undefined;
}

/**
 * Step 2: the subject, the fields of the START block, a description and loose attachments; "Crear y enviar" creates the
 * ticket and opens it. Before that, the form says where the ticket goes and who gets its first step, and when that step
 * needs its assignee chosen, asks for that person among its candidates.
 */
export function RequestForm({ subcategoryId, companyId, requesterId, priorityId, start }: RequestFormProps) {
  const { t } = useTranslation('tickets');
  const navigate = useNavigate();
  const fields = typedFields(start.fields);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<readonly string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const client = useApiClient();
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const create = useTicketMutation((client, args: CreateArgs) =>
    createTicket(client, {
      subcategoryId,
      startStepId: start.stepId,
      companyId,
      ...(requesterId === undefined ? {} : { requesterId }),
      ...(priorityId === undefined ? {} : { priorityId }),
      title: args.title,
      description: isBlankRichText(args.description) ? '' : args.description,
      values: args.values,
      attachments: [...args.attachments],
      ...(args.assigneeId === undefined ? {} : { assigneeId: args.assigneeId }),
    }),
  );
  const stepFields = useStepFields(fields, {}, create.error);
  const preview = useNextStepPreview([subcategoryId, start.stepId, companyId, requesterId ?? ''], stepFields.draft(), (values) =>
    previewCreation(client, { subcategoryId, startStepId: start.stepId, companyId, ...(requesterId === undefined ? {} : { requesterId }), values: { ...values } }),
  );
  const next = useNextAssignee(choicesOfPreview(preview.data));
  const titleMissing = submitted && title.trim() === '';
  const busy = create.isPending || stepFields.busy || attaching;

  const submit = () => {
    setSubmitted(true);
    const collected = stepFields.collect();
    const assignee = next.request();
    if (title.trim() === '' || !collected.ok || !assignee.ok) return;
    create.mutate(
      { title: title.trim(), description, values: collected.values, attachments, assigneeId: assignee.assigneeId },
      { onSuccess: (ticket) => void navigate(ticketPath(ticket.id)), onError: next.onError },
    );
  };

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) submit();
      }}
    >
      <Card title={<SectionTitle number={2} title={t('new.data.title')} />} actions={<span className={styles.hint}>{t('new.data.hint')}</span>}>
        <div className={styles.fields}>
          {start.description !== null && start.description !== '' && <RichText html={textAsHtml(start.description)} />}
          {stepFields.rejected && <p className={styles.fix}>{t('advance.fixFields')}</p>}
          <TextField
            label={t('new.data.subject')}
            required
            value={title}
            maxLength={TITLE_MAX}
            placeholder={t('new.data.subjectPlaceholder')}
            error={titleMissing ? t('new.data.subjectRequired') : undefined}
            onChange={(event) => setTitle(event.target.value)}
          />
          {fields.map((field) => (
            <StepFieldInput key={field.id} field={field} knownLabels={{}} knownFiles={{}} {...stepFields.inputProps(field)} />
          ))}
          <RichTextEditor label={t('new.data.description')} value={description} maxLength={DESCRIPTION_HTML_MAX} minHeight={160} placeholder={t('new.data.descriptionPlaceholder')} onValueChange={setDescription} />
          <FilePicker label={t('new.data.attachments')} required={false} value={attachments} knownNames={{}} error={undefined} onChange={setAttachments} onBusyChange={setAttaching} />
          <NextStepSummary preview={preview.data} loading={preview.isFetching} failed={preview.isError} timeZone={timeZone} />
          <NextAssigneeField next={next} />
        </div>
      </Card>
      <div className={styles.footer}>
        <ButtonLink to={paths.tickets} variant="ghost">
          {t('actions.cancel')}
        </ButtonLink>
        <div className={styles.footerEnd}>
          {!stepFields.rejected && <CreationError error={next.shownError(create.error)} />}
          <Button type="submit" variant="brand" disabled={busy}>
            {create.isPending ? t('actions.sending') : t('new.submit')}
          </Button>
        </div>
      </div>
    </form>
  );
}

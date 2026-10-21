import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { templatesQueryOptions } from '@/features/profile';
import { ApiError, genericErrorMessage } from '@/shared/api';
import { htmlToPlainText } from '@/shared/lib/plain-text-html';
import { useApiClient } from '@/shared/session';
import { Button, Select, TextArea } from '@/shared/ui';
import { useCommentOnTicket } from '../hooks/use-comment-on-ticket';
import styles from './CommentForm.module.css';

const FORBIDDEN = 403;

/**
 * A plain-text comment for everyone who can see the ticket; it shows up in the activity once saved. The person's text
 * templates (their own and the ones shared with them) can be inserted, to edit before sending.
 */
export function CommentForm({ ticketId }: { readonly ticketId: string }) {
  const { t } = useTranslation('tickets');
  const { t: tCommon } = useTranslation();
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  const comment = useCommentOnTicket(ticketId);
  const templates = useQuery(templatesQueryOptions(useApiClient()));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (text.trim() === '') {
      setMissing(true);
      return;
    }
    comment.mutate(text, { onSuccess: () => setText('') });
  };

  const failure = (): string | undefined => {
    if (missing) return t('detail.comment.required');
    if (!comment.isError) return undefined;
    if (comment.error instanceof ApiError && comment.error.status === FORBIDDEN) return t('detail.comment.forbidden');
    const message = genericErrorMessage(comment.error);
    return 'values' in message ? tCommon(message.key, message.values) : tCommon(message.key);
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <TextArea
        label={t('detail.comment.label')}
        placeholder={t('detail.comment.placeholder')}
        value={text}
        maxLength={5000}
        error={failure()}
        onChange={(event) => {
          setText(event.target.value);
          setMissing(false);
        }}
      />
      {templates.data !== undefined && templates.data.length > 0 && (
        <div className={styles.template}>
          <Select
            label={t('detail.comment.template')}
            value=""
            placeholder={t('detail.comment.chooseTemplate')}
            options={templates.data.map((template) => ({ value: template.id, label: template.title }))}
            onChange={(event) => {
              const chosen = templates.data.find((template) => template.id === event.target.value);
              if (chosen === undefined) return;
              const inserted = htmlToPlainText(chosen.bodyHtml);
              setText((current) => (current.trim() === '' ? inserted : `${current.trimEnd()}\n\n${inserted}`));
              setMissing(false);
            }}
          />
        </div>
      )}
      <div>
        <Button type="submit" disabled={comment.isPending}>
          {comment.isPending ? t('detail.comment.sending') : t('detail.comment.submit')}
        </Button>
      </div>
    </form>
  );
}

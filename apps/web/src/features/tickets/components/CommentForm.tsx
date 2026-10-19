import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, genericErrorMessage } from '@/shared/api';
import { Button, TextArea } from '@/shared/ui';
import { useCommentOnTicket } from '../hooks/use-comment-on-ticket';
import styles from './CommentForm.module.css';

const FORBIDDEN = 403;

/** A plain-text comment for everyone who can see the ticket; it shows up in the activity once saved. */
export function CommentForm({ ticketId }: { readonly ticketId: string }) {
  const { t } = useTranslation('tickets');
  const { t: tCommon } = useTranslation();
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  const comment = useCommentOnTicket(ticketId);

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
      <div>
        <Button type="submit" disabled={comment.isPending}>
          {comment.isPending ? t('detail.comment.sending') : t('detail.comment.submit')}
        </Button>
      </div>
    </form>
  );
}

import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, genericErrorMessage } from '@/shared/api';
import { Button, isBlankRichText } from '@/shared/ui';
import { useCommentOnTicket } from '../hooks/use-comment-on-ticket';
import { FilePicker } from './advance/FileInput';
import styles from './CommentForm.module.css';
import { ResponseEditor } from './ResponseEditor';

const FORBIDDEN = 403;

/**
 * A comment, written in the rich text editor (with the person's text templates), for everyone who can see the ticket; it shows up in the
 * activity once saved. Files can go with it: they are uploaded as they are chosen and appear under the comment in the activity.
 */
export function CommentForm({ ticketId }: { readonly ticketId: string }) {
  const { t } = useTranslation('tickets');
  const { t: tCommon } = useTranslation();
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  const [attachments, setAttachments] = useState<readonly string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const comment = useCommentOnTicket(ticketId);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBlankRichText(text)) {
      setMissing(true);
      return;
    }
    comment.mutate(
      { html: text, attachments },
      {
        onSuccess: () => {
          setText('');
          setAttachments([]);
        },
      },
    );
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
      <ResponseEditor
        label={t('detail.comment.label')}
        placeholder={t('detail.comment.placeholder')}
        value={text}
        error={failure()}
        onValueChange={(next) => {
          setText(next);
          setMissing(false);
        }}
      />
      <FilePicker label={t('detail.comment.attachments')} required={false} value={attachments} knownNames={{}} error={undefined} onChange={setAttachments} onBusyChange={setAttaching} />
      <div>
        <Button type="submit" disabled={comment.isPending || attaching}>
          {comment.isPending ? t('detail.comment.sending') : t('detail.comment.submit')}
        </Button>
      </div>
    </form>
  );
}

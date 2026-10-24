import { RICH_TEXT_MAX } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { templatesQueryOptions } from '@/features/profile';
import { useApiClient } from '@/shared/session';
import { Button, isBlankRichText, RichTextEditor, type RichTextEditorHandle, Select } from '@/shared/ui';
import styles from './ResponseEditor.module.css';

export interface ResponseEditorProps {
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (html: string) => void;
  readonly placeholder?: string | undefined;
  readonly error?: string | undefined;
  readonly minHeight?: number | undefined;
}

/**
 * The editor for an answer on the ticket (a comment, the note that advances or closes it), with the person's text templates (their own and
 * the ones shared with them) inserted where the cursor is, to edit before sending, and a button that clears what is written, preloaded
 * instructions included.
 */
export function ResponseEditor({ label, value, onValueChange, placeholder, error, minHeight }: ResponseEditorProps) {
  const { t } = useTranslation('tickets');
  const editor = useRef<RichTextEditorHandle>(null);
  const templates = useQuery(templatesQueryOptions(useApiClient()));
  return (
    <div className={styles.response}>
      <RichTextEditor ref={editor} label={label} placeholder={placeholder} value={value} maxLength={RICH_TEXT_MAX} error={error} minHeight={minHeight} onValueChange={onValueChange} />
      <div className={styles.tools}>
        {templates.data !== undefined && templates.data.length > 0 && (
          <div className={styles.template}>
            <Select
              label={t('detail.comment.template')}
              value=""
              placeholder={t('detail.comment.chooseTemplate')}
              options={templates.data.map((template) => ({ value: template.id, label: template.title }))}
              onChange={(event) => {
                const chosen = templates.data.find((template) => template.id === event.target.value);
                if (chosen !== undefined) editor.current?.insertHtml(chosen.bodyHtml);
              }}
            />
          </div>
        )}
        <Button variant="ghost" className={styles.clear} disabled={isBlankRichText(value)} onClick={() => onValueChange('')}>
          {t('detail.comment.clear')}
        </Button>
      </div>
    </div>
  );
}

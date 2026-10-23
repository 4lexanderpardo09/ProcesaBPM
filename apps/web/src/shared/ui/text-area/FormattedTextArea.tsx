import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type Edited, listLines, wrapSelection } from '@/shared/lib/text-format';
import { TextArea, type TextAreaProps } from './TextArea';
import styles from './TextArea.module.css';

export type FormattedTextAreaProps = Omit<TextAreaProps, 'value' | 'onChange'> & {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
};

/**
 * A text area with buttons for the light formatting `plainTextToHtml` understands (bold, italics, lists). It writes the
 * marks into the text, so what is typed by hand works the same.
 */
export function FormattedTextArea({ value, onValueChange, label, hint, ...props }: FormattedTextAreaProps) {
  const { t } = useTranslation();
  const area = useRef<HTMLTextAreaElement>(null);
  const apply = (edit: (text: string, start: number, end: number) => Edited) => {
    const element = area.current;
    if (element === null) return;
    const edited = edit(value, element.selectionStart, element.selectionEnd);
    onValueChange(edited.text);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(edited.start, edited.end);
    });
  };
  return (
    <div className={styles.formatted}>
      <div className={styles.toolbar} role="toolbar" aria-label={t('formatting.toolbar', { field: label })}>
        <button type="button" className={styles.tool} title={t('formatting.boldHint')} aria-label={t('formatting.bold')} onClick={() => apply((text, start, end) => wrapSelection(text, start, end, '**'))}>
          <strong>N</strong>
        </button>
        <button type="button" className={styles.tool} title={t('formatting.italicHint')} aria-label={t('formatting.italic')} onClick={() => apply((text, start, end) => wrapSelection(text, start, end, '_'))}>
          <em>C</em>
        </button>
        <button type="button" className={styles.tool} title={t('formatting.listHint')} aria-label={t('formatting.list')} onClick={() => apply((text, start, end) => listLines(text, start, end, false))}>
          •
        </button>
        <button type="button" className={styles.tool} title={t('formatting.numberedHint')} aria-label={t('formatting.numbered')} onClick={() => apply((text, start, end) => listLines(text, start, end, true))}>
          1.
        </button>
      </div>
      <TextArea ref={area} label={label} hint={hint ?? t('formatting.hint')} value={value} onChange={(event) => onValueChange(event.target.value)} {...props} />
    </div>
  );
}

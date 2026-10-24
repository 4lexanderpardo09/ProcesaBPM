import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { type Ref, useEffect, useId, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/shared/lib/cx';
import fieldStyles from '../field/field.module.css';
import type { FieldMessages } from '../field/FieldFrame';
import { EDITOR_EXTENSIONS } from './editor-extensions';
import { EditorToolbar } from './EditorToolbar';
import styles from './RichTextEditor.module.css';

/** The empty line the editor keeps after a final list or table, to write below it: not part of the text. */
const TRAILING_EMPTY_PARAGRAPHS = /(<p><\/p>)+$/;

/** What a form can do with the editor besides reading its value. */
export interface RichTextEditorHandle {
  /** Puts HTML (a text template, instructions) where the cursor is, or at the end when the editor never had it. */
  readonly insertHtml: (html: string) => void;
  readonly focus: () => void;
}

export interface RichTextEditorProps extends FieldMessages {
  /** HTML, as the API keeps it; empty when there is nothing written. */
  readonly value: string;
  readonly onValueChange: (html: string) => void;
  readonly placeholder?: string | undefined;
  /** The most HTML the API takes for this text: past it the editor says so. */
  readonly maxLength?: number | undefined;
  readonly disabled?: boolean | undefined;
  /** Height of the writing area before it grows with the text. */
  readonly minHeight?: number | undefined;
  readonly ref?: Ref<RichTextEditorHandle> | undefined;
}

/**
 * The editor for descriptions, comments and every answer: headings, emphasis, colors, lists, alignment, links and
 * tables (a range copied from a spreadsheet is pasted as a table). It writes HTML the API sanitizes with the same
 * allowlist and the activity shows with RichText. It works as a controlled field: `value` set from outside (a reset
 * after sending, a text loaded later) replaces what is in it.
 */
export function RichTextEditor({ label, hint, error, required, value, onValueChange, placeholder, maxLength, disabled = false, minHeight = 120, ref }: RichTextEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const tooLong = maxLength !== undefined && value.length > maxLength;
  const shownError = error ?? (tooLong ? t('editor.tooLong') : undefined);
  const describedBy = cx(hint !== undefined && hintId, shownError !== undefined && errorId);
  // The last HTML this editor reported: a `value` equal to it is the editor's own echo, not a change from outside.
  const reported = useRef(value);
  const onChange = useRef(onValueChange);
  useEffect(() => {
    onChange.current = onValueChange;
  }, [onValueChange]);

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: value,
    editable: !disabled,
    onUpdate: ({ editor: current }) => {
      const html = current.isEmpty ? '' : current.getHTML().replace(TRAILING_EMPTY_PARAGRAPHS, '');
      reported.current = html;
      onChange.current(html);
    },
  });
  const empty = useEditorState({ editor, selector: ({ editor: current }) => current.isEmpty });

  useEffect(() => {
    if (value === reported.current) return;
    reported.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  useEffect(() => {
    editor.setOptions({
      editorProps: {
        attributes: {
          class: styles.content ?? '',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-labelledby': labelId,
          ...(describedBy !== '' && { 'aria-describedby': describedBy }),
          ...(shownError !== undefined && { 'aria-invalid': 'true' }),
          ...(required === true && { 'aria-required': 'true' }),
          style: `min-height: ${minHeight}px`,
        },
      },
    });
  }, [editor, labelId, describedBy, shownError, required, minHeight]);

  useImperativeHandle(ref, () => ({ insertHtml: (html) => editor.chain().focus().insertContent(html).run(), focus: () => editor.commands.focus() }), [editor]);

  return (
    <div className={fieldStyles.field}>
      {/* Not a <label>: the editable area is not a form control; it takes its name through aria-labelledby. */}
      <span id={labelId} className={cx('text-label', fieldStyles.label)} onClick={() => editor.commands.focus()}>
        {label}
        {required === true && (
          <span className={fieldStyles.required} aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </span>
      <div className={cx(styles.box, shownError !== undefined && styles.invalid, disabled && styles.disabled)}>
        <EditorToolbar editor={editor} label={label} disabled={disabled} />
        <div className={styles.area}>
          {empty && placeholder !== undefined && (
            <p className={styles.placeholder} aria-hidden="true">
              {placeholder}
            </p>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
      {hint !== undefined && (
        <p id={hintId} className={fieldStyles.hint}>
          {hint}
        </p>
      )}
      {shownError !== undefined && (
        <p id={errorId} className={fieldStyles.error}>
          {shownError}
        </p>
      )}
    </div>
  );
}

/** Whether the editor's HTML holds nothing to send: no text, no table, no line. */
export function isBlankRichText(html: string): boolean {
  if (html.trim() === '') return true;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  return (body.textContent ?? '').trim() === '' && body.querySelector('table, hr') === null;
}

import { type Editor, useEditorState } from '@tiptap/react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/shared/lib/cx';
import { isSafeLink } from './editor-extensions';
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BulletListIcon,
  ClearFormatIcon,
  HighlightIcon,
  LinkIcon,
  NumberedListIcon,
  QuoteIcon,
  RedoIcon,
  TableIcon,
  UndoIcon,
} from './editor-icons';
import styles from './RichTextEditor.module.css';

/** Text colors that read well on white, named for the buttons. */
const TEXT_COLORS = [
  { name: 'red', value: '#c62828' },
  { name: 'orange', value: '#c2410c' },
  { name: 'green', value: '#047857' },
  { name: 'blue', value: '#0369a1' },
  { name: 'violet', value: '#6d28d9' },
  { name: 'gray', value: '#64748b' },
] as const;
/** Light backgrounds the text stays readable on. */
const HIGHLIGHTS = [
  { name: 'yellow', value: '#fef08a' },
  { name: 'green', value: '#bbf7d0' },
  { name: 'blue', value: '#bae6fd' },
  { name: 'pink', value: '#fbcfe8' },
  { name: 'orange', value: '#fed7aa' },
] as const;
const ALIGNMENTS = [
  { value: 'left', icon: AlignLeftIcon },
  { value: 'center', icon: AlignCenterIcon },
  { value: 'right', icon: AlignRightIcon },
  { value: 'justify', icon: AlignJustifyIcon },
] as const;
type Block = 'p' | 'h2' | 'h3';

/** The editor's buttons: what the selection has is shown pressed, and the table ones appear inside a table. */
export function EditorToolbar({ editor, label, disabled }: { readonly editor: Editor; readonly label: string; readonly disabled: boolean }) {
  const { t } = useTranslation();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      block: (current.isActive('heading', { level: 2 }) ? 'h2' : current.isActive('heading', { level: 3 }) ? 'h3' : 'p') as Block,
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
      align: ALIGNMENTS.find((alignment) => alignment.value !== 'left' && current.isActive({ textAlign: alignment.value }))?.value ?? 'left',
      color: current.getAttributes('textStyle').color as string | undefined,
      highlight: current.getAttributes('textStyle').backgroundColor as string | undefined,
      link: current.getAttributes('link').href as string | undefined,
      inTable: current.isActive('table'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  const setBlock = (block: Block) => {
    if (block === 'p') chain().setParagraph().run();
    else chain().setHeading({ level: block === 'h2' ? 2 : 3 }).run();
  };

  return (
    <div className={styles.toolbar} role="toolbar" aria-label={t('editor.toolbar', { field: label })} aria-disabled={disabled}>
      <div className={styles.group}>
        <Tool label={t('editor.undo')} disabled={disabled || !state.canUndo} onClick={() => chain().undo().run()}>
          <UndoIcon />
        </Tool>
        <Tool label={t('editor.redo')} disabled={disabled || !state.canRedo} onClick={() => chain().redo().run()}>
          <RedoIcon />
        </Tool>
      </div>
      <select className={styles.blockSelect} aria-label={t('editor.block')} value={state.block} disabled={disabled} onChange={(event) => setBlock(event.target.value as Block)}>
        <option value="p">{t('editor.paragraph')}</option>
        <option value="h2">{t('editor.heading')}</option>
        <option value="h3">{t('editor.subheading')}</option>
      </select>
      <div className={styles.group}>
        <Tool label={t('editor.bold')} pressed={state.bold} disabled={disabled} onClick={() => chain().toggleBold().run()}>
          <strong>N</strong>
        </Tool>
        <Tool label={t('editor.italic')} pressed={state.italic} disabled={disabled} onClick={() => chain().toggleItalic().run()}>
          <em>C</em>
        </Tool>
        <Tool label={t('editor.underline')} pressed={state.underline} disabled={disabled} onClick={() => chain().toggleUnderline().run()}>
          <u>S</u>
        </Tool>
        <Tool label={t('editor.strike')} pressed={state.strike} disabled={disabled} onClick={() => chain().toggleStrike().run()}>
          <s>T</s>
        </Tool>
        <Menu
          label={t('editor.color')}
          disabled={disabled}
          icon={
            <span className={styles.colorGlyph} style={{ borderColor: state.color ?? 'currentColor' }}>
              A
            </span>
          }
        >
          {(close) => (
            <Swatches
              colors={TEXT_COLORS.map((color) => ({ value: color.value, label: t(`editor.colors.${color.name}`) }))}
              current={state.color}
              none={t('editor.noColor')}
              onPick={(value) => {
                if (value === undefined) chain().unsetColor().run();
                else chain().setColor(value).run();
                close();
              }}
            />
          )}
        </Menu>
        <Menu label={t('editor.highlight')} disabled={disabled} icon={<HighlightIcon />}>
          {(close) => (
            <Swatches
              background
              colors={HIGHLIGHTS.map((color) => ({ value: color.value, label: t(`editor.highlights.${color.name}`) }))}
              current={state.highlight}
              none={t('editor.noHighlight')}
              onPick={(value) => {
                if (value === undefined) chain().unsetBackgroundColor().run();
                else chain().setBackgroundColor(value).run();
                close();
              }}
            />
          )}
        </Menu>
      </div>
      <div className={styles.group}>
        <Tool label={t('editor.bulletList')} pressed={state.bulletList} disabled={disabled} onClick={() => chain().toggleBulletList().run()}>
          <BulletListIcon />
        </Tool>
        <Tool label={t('editor.orderedList')} pressed={state.orderedList} disabled={disabled} onClick={() => chain().toggleOrderedList().run()}>
          <NumberedListIcon />
        </Tool>
        <Tool label={t('editor.quote')} pressed={state.blockquote} disabled={disabled} onClick={() => chain().toggleBlockquote().run()}>
          <QuoteIcon />
        </Tool>
      </div>
      <div className={styles.group}>
        {ALIGNMENTS.map(({ value, icon: Icon }) => (
          <Tool key={value} label={t(`editor.align.${value}`)} pressed={state.align === value} disabled={disabled} onClick={() => chain().setTextAlign(value).run()}>
            <Icon />
          </Tool>
        ))}
      </div>
      <div className={styles.group}>
        <Menu label={t('editor.link')} pressed={state.link !== undefined} disabled={disabled} icon={<LinkIcon />}>
          {(close) => (
            <LinkForm
              current={state.link}
              onApply={(href) => {
                chain().extendMarkRange('link').setLink({ href }).run();
                close();
              }}
              onRemove={() => {
                chain().extendMarkRange('link').unsetLink().run();
                close();
              }}
            />
          )}
        </Menu>
        <Tool label={t('editor.insertTable')} disabled={disabled || state.inTable} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <TableIcon />
        </Tool>
        <Tool label={t('editor.clear')} disabled={disabled} onClick={() => chain().unsetAllMarks().clearNodes().unsetTextAlign().run()}>
          <ClearFormatIcon />
        </Tool>
      </div>
      {state.inTable && !disabled && (
        <div className={cx(styles.group, styles.tableTools)} role="group" aria-label={t('editor.table.label')}>
          <TextTool onClick={() => chain().addRowAfter().run()}>{t('editor.table.addRow')}</TextTool>
          <TextTool onClick={() => chain().addColumnAfter().run()}>{t('editor.table.addColumn')}</TextTool>
          <TextTool onClick={() => chain().deleteRow().run()}>{t('editor.table.deleteRow')}</TextTool>
          <TextTool onClick={() => chain().deleteColumn().run()}>{t('editor.table.deleteColumn')}</TextTool>
          <TextTool onClick={() => chain().toggleHeaderRow().run()}>{t('editor.table.headerRow')}</TextTool>
          <TextTool onClick={() => chain().deleteTable().run()}>{t('editor.table.delete')}</TextTool>
        </div>
      )}
    </div>
  );
}

interface ToolProps {
  readonly label: string;
  readonly pressed?: boolean | undefined;
  readonly expanded?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

/** A toolbar button. It never takes the focus on press, so the selection in the text stays where it was. */
function Tool({ label, pressed, expanded, disabled, onClick, children }: ToolProps) {
  return (
    <button
      type="button"
      className={styles.tool}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TextTool({ onClick, children }: { readonly onClick: () => void; readonly children: ReactNode }) {
  return (
    <button type="button" className={styles.textTool} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

/** A toolbar button that opens a small panel below it; a click elsewhere or Escape closes it. */
function Menu({ label, icon, pressed, disabled, children }: { readonly label: string; readonly icon: ReactNode; readonly pressed?: boolean; readonly disabled: boolean; readonly children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: MouseEvent) => {
      if (!(root.current?.contains(event.target as Node) ?? false)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className={styles.menuRoot} ref={root}>
      <Tool label={label} pressed={pressed} expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        {icon}
      </Tool>
      {open && (
        <div className={styles.menu} role="group" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface SwatchesProps {
  readonly colors: readonly { readonly value: string; readonly label: string }[];
  readonly current: string | undefined;
  readonly none: string;
  readonly background?: boolean;
  readonly onPick: (value: string | undefined) => void;
}

function Swatches({ colors, current, none, background = false, onPick }: SwatchesProps) {
  return (
    <div className={styles.swatches}>
      {colors.map((color) => (
        <button
          key={color.value}
          type="button"
          className={styles.swatch}
          title={color.label}
          aria-label={color.label}
          aria-pressed={current === color.value}
          style={background ? { background: color.value } : { color: color.value }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(color.value)}
        >
          {background ? '' : 'A'}
        </button>
      ))}
      <button type="button" className={styles.textTool} onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(undefined)}>
        {none}
      </button>
    </div>
  );
}

/** The address of a link: a bare `example.com` becomes https; anything that is not a web or mail address is refused. */
function LinkForm({ current, onApply, onRemove }: { readonly current: string | undefined; readonly onApply: (href: string) => void; readonly onRemove: () => void }) {
  const { t } = useTranslation();
  const [href, setHref] = useState(current ?? '');
  const [invalid, setInvalid] = useState(false);
  // Not a <form>: the editor usually sits inside one, and forms do not nest.
  const apply = (event: FormEvent) => {
    event.preventDefault();
    const typed = href.trim();
    const full = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`;
    if (typed === '' || !isSafeLink(full)) {
      setInvalid(true);
      return;
    }
    onApply(full);
  };
  return (
    <div className={styles.linkForm}>
      <input
        className={styles.linkInput}
        type="url"
        aria-label={t('editor.linkAddress')}
        aria-invalid={invalid}
        placeholder="https://"
        value={href}
        // The panel opens on purpose to type the address.
        autoFocus
        onChange={(event) => {
          setHref(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply(event);
        }}
      />
      <button type="button" className={styles.textTool} onClick={apply}>
        {t('editor.linkApply')}
      </button>
      {current !== undefined && (
        <button type="button" className={styles.textTool} onClick={onRemove}>
          {t('editor.linkRemove')}
        </button>
      )}
      {invalid && <p className={styles.linkError}>{t('editor.linkInvalid')}</p>}
    </div>
  );
}

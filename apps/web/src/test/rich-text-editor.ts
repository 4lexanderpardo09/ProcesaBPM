import { act } from '@testing-library/react';
import type { Editor } from '@tiptap/react';

/**
 * Writes `text` where the cursor of a RichTextEditor is (or at its end, with `at: 'end'`), as plain text (`<` is a
 * character, not markup), each `\n` pressing Enter. jsdom drops keystrokes in ProseMirror's editable area (it reads
 * them back from the DOM mutations a browser makes), so tests write through the editor the textbox belongs to.
 */
export function typeInEditor(textbox: HTMLElement, text: string, { at = 'cursor' }: { readonly at?: 'cursor' | 'end' } = {}): void {
  const editor = (textbox as HTMLElement & { editor?: Editor }).editor;
  if (editor === undefined) throw new Error('The element is not a rich text editor.');
  act(() => {
    editor.commands.focus(at === 'end' ? 'end' : undefined);
    text.split('\n').forEach((line, index) => {
      // Enter through the editor's own keymap: a new paragraph, or a new item inside a list.
      if (index > 0) editor.commands.keyboardShortcut('Enter');
      if (line !== '') editor.commands.insertContent({ type: 'text', text: line });
    });
  });
}

/** Selects everything written in a RichTextEditor, as Ctrl+A does (jsdom does not always pass the shortcut on). */
export function selectAllInEditor(textbox: HTMLElement): void {
  const editor = (textbox as HTMLElement & { editor?: Editor }).editor;
  if (editor === undefined) throw new Error('The element is not a rich text editor.');
  act(() => {
    editor.chain().focus().selectAll().run();
  });
}

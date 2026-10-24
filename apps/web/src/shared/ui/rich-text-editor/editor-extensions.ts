import { TableKit } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { BackgroundColor, Color, TextStyle } from '@tiptap/extension-text-style';
import { StarterKit } from '@tiptap/starter-kit';

const LINK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/** A web or mail address, the only links the API keeps. */
export function isSafeLink(href: string): boolean {
  try {
    return LINK_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

/**
 * What the editor can write, kept to what the API's sanitizer lets through: paragraphs and two heading levels,
 * emphasis, lists, quotes, code, safe links, text and background colors, alignment and tables (typed, or pasted from
 * a spreadsheet). Tables have no resizing: the widths it writes would only be noise.
 */
export const EDITOR_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    link: { openOnClick: false, autolink: true, defaultProtocol: 'https', isAllowedUri: (url) => isSafeLink(url) },
  }),
  TextStyle,
  Color,
  BackgroundColor,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TableKit.configure({ table: { resizable: false } }),
];

import { createElement, type CSSProperties, Fragment, type ReactNode } from 'react';

/** The tags the API's sanitizer lets through (`apps/api/src/infrastructure/text/rich-text.ts`): nothing else is drawn as markup. */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'h2', 'h3', 'h4', 'span', 'hr',
  'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'th', 'td',
]);
/** Tags that never hold anything: React refuses children on them, even none. */
const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr', 'col']);
/** Inside these, text between the tags is only the indentation of the markup, and the DOM does not allow it there. */
const TABLE_PARTS: ReadonlySet<string> = new Set(['table', 'colgroup', 'thead', 'tbody', 'tr']);
/** Tags whose content is never text to show (the API drops them too). */
const NON_TEXT_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template']);
const LINK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;
const ALIGN = /^(left|right|center|justify)$/;
const SIZE = /^\d{1,4}(\.\d+)?px$/;
const MAX_SPAN = 50;

/**
 * Sanitized HTML from the API as React elements, without ever handing HTML to the DOM: DOMParser builds an inert
 * document (no scripts run, nothing loads) and only allowed tags become elements. Other tags keep just their text
 * (scripts, styles and the like not even that), links outside http, https and mailto lose their href, and of the
 * styles only colors, alignment and table widths of a known shape are kept, as React styles.
 */
export function richTextNodes(html: string): ReactNode[] {
  return childrenOf(new DOMParser().parseFromString(html, 'text/html').body);
}

function childrenOf(node: Node): ReactNode[] {
  return Array.from(node.childNodes, (child, index) => nodeToReact(child, index));
}

function nodeToReact(node: Node, key: number): ReactNode {
  if (node.nodeType === TEXT_NODE) return TABLE_PARTS.has(node.parentNode?.nodeName.toLowerCase() ?? '') ? null : node.textContent;
  if (node.nodeType !== ELEMENT_NODE) return null;
  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (NON_TEXT_TAGS.has(tag)) return null;
  if (!ALLOWED_TAGS.has(tag)) return createElement(Fragment, { key }, childrenOf(element));
  const props = { key, style: safeStyle(element, tag), ...spans(element, tag) };
  if (VOID_TAGS.has(tag)) return createElement(tag, props);
  const children = childrenOf(element);
  if (tag === 'a') return link(element, key, children);
  // A wide table scrolls on its own instead of widening the page.
  if (tag === 'table') return createElement('div', { key, 'data-rich-table': '' }, createElement('table', props, children));
  return createElement(tag, props, children);
}

function safeStyle(element: HTMLElement, tag: string): CSSProperties | undefined {
  const style: CSSProperties = {};
  const color = element.style.getPropertyValue('color');
  const background = element.style.getPropertyValue('background-color');
  const align = element.style.getPropertyValue('text-align');
  if (COLOR.test(color)) style.color = color;
  if (COLOR.test(background)) style.backgroundColor = background;
  if (ALIGN.test(align)) style.textAlign = align as CSSProperties['textAlign'];
  if (tag === 'table' || tag === 'col') {
    const width = element.style.getPropertyValue('width');
    const minWidth = element.style.getPropertyValue('min-width');
    if (SIZE.test(width)) style.width = width;
    if (SIZE.test(minWidth)) style.minWidth = minWidth;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function spans(element: Element, tag: string): { colSpan?: number; rowSpan?: number } {
  if (tag !== 'td' && tag !== 'th') return {};
  const span = (name: string) => {
    const value = Number(element.getAttribute(name));
    return Number.isInteger(value) && value > 1 && value <= MAX_SPAN ? value : undefined;
  };
  const colSpan = span('colspan');
  const rowSpan = span('rowspan');
  return { ...(colSpan !== undefined && { colSpan }), ...(rowSpan !== undefined && { rowSpan }) };
}

function link(element: Element, key: number, children: ReactNode[]): ReactNode {
  const href = safeHref(element.getAttribute('href'));
  if (href === undefined) return createElement(Fragment, { key }, children);
  return createElement('a', { key, href, target: '_blank', rel: 'noopener noreferrer nofollow' }, children);
}

function safeHref(href: string | null): string | undefined {
  if (href === null) return undefined;
  try {
    return LINK_PROTOCOLS.has(new URL(href).protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

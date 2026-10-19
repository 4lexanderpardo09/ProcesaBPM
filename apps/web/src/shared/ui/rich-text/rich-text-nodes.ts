import { createElement, Fragment, type ReactNode } from 'react';

/** The tags the API's sanitizer lets through (`apps/api/src/infrastructure/text/rich-text.ts`): nothing else is drawn as markup. */
const ALLOWED_TAGS: ReadonlySet<string> = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'h3', 'h4']);
/** Tags whose content is never text to show (the API drops them too). */
const NON_TEXT_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template']);
const LINK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Sanitized HTML from the API as React elements, without ever handing HTML to the DOM: DOMParser builds an inert
 * document (no scripts run, nothing loads) and only allowed tags become elements. Other tags keep just their text
 * (scripts, styles and the like not even that), and links outside http, https and mailto lose their href.
 */
export function richTextNodes(html: string): ReactNode[] {
  return childrenOf(new DOMParser().parseFromString(html, 'text/html').body);
}

function childrenOf(node: Node): ReactNode[] {
  return Array.from(node.childNodes, (child, index) => nodeToReact(child, index));
}

function nodeToReact(node: Node, key: number): ReactNode {
  if (node.nodeType === TEXT_NODE) return node.textContent;
  if (node.nodeType !== ELEMENT_NODE) return null;
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (NON_TEXT_TAGS.has(tag)) return null;
  const children = childrenOf(element);
  if (tag === 'br') return createElement('br', { key });
  if (tag === 'a') return link(element, key, children);
  if (!ALLOWED_TAGS.has(tag)) return createElement(Fragment, { key }, children);
  return createElement(tag, { key }, children);
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

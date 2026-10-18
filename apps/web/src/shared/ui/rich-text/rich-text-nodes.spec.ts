import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { richTextNodes } from './rich-text-nodes';

const markup = (html: string) => renderToStaticMarkup(createElement('div', null, richTextNodes(html)));

describe('richTextNodes', () => {
  it('keeps the formatting tags the API allows', () => {
    expect(markup('<p>Hola <strong>equipo</strong></p><ul><li>uno</li></ul>')).toBe('<div><p>Hola <strong>equipo</strong></p><ul><li>uno</li></ul></div>');
  });

  it('opens safe links in a new tab without passing the opener', () => {
    expect(markup('<a href="https://example.com/a">ver</a>')).toBe('<div><a href="https://example.com/a" target="_blank" rel="noopener noreferrer nofollow">ver</a></div>');
  });

  it('drops the href of links outside http, https and mailto', () => {
    expect(markup('<a href="javascript:alert(1)">clic</a><a href="/relative">aquí</a>')).toBe('<div>clicaquí</div>');
  });

  it('keeps only the text of tags outside the list and never their attributes', () => {
    expect(markup('<div onclick="x()"><img src="x" onerror="y()">texto <span style="color:red">rojo</span></div>')).toBe('<div>texto rojo</div>');
  });

  it('drops scripts and styles with their content', () => {
    expect(markup('<script>alert(1)</script><style>p{}</style><p>ok</p>')).toBe('<div><p>ok</p></div>');
  });

  it('escapes text that looks like markup', () => {
    expect(markup('<p>a &lt;b&gt; c</p>')).toBe('<div><p>a &lt;b&gt; c</p></div>');
  });
});

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
    expect(markup('<div onclick="x()"><img src="x" onerror="y()">texto <span title="t" style="color:red">rojo</span></div>')).toBe('<div>texto <span>rojo</span></div>');
  });

  it('keeps colors and alignment of a known shape and nothing else of the style', () => {
    expect(markup('<p style="text-align: center; position: fixed"><span style="color: #c62828; background-color: rgb(255, 245, 157); background-image: url(x)">ojo</span></p>')).toBe(
      '<div><p style="text-align:center"><span style="color:rgb(198, 40, 40);background-color:rgb(255, 245, 157)">ojo</span></p></div>',
    );
  });

  it('draws tables with their spans and widths, in a box that scrolls, without the indentation between rows', () => {
    const html = '<table style="min-width: 50px; float: left"><colgroup><col style="width: 120px"></colgroup>\n<tbody>\n<tr><th colspan="2">A</th></tr><tr><td rowspan="1">1</td><td colspan="999">2</td></tr></tbody></table><hr>';
    expect(markup(html)).toBe(
      '<div><div data-rich-table=""><table style="min-width:50px"><colgroup><col style="width:120px"/></colgroup><tbody><tr><th colSpan="2">A</th></tr><tr><td>1</td><td>2</td></tr></tbody></table></div><hr/></div>',
    );
  });

  it('drops scripts and styles with their content', () => {
    expect(markup('<script>alert(1)</script><style>p{}</style><p>ok</p>')).toBe('<div><p>ok</p></div>');
  });

  it('escapes text that looks like markup', () => {
    expect(markup('<p>a &lt;b&gt; c</p>')).toBe('<div><p>a &lt;b&gt; c</p></div>');
  });
});

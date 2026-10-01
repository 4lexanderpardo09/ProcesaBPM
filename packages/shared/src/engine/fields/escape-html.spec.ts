import { describe, expect, it } from 'vitest';
import { plainTextToHtml } from './escape-html.js';

describe('plainTextToHtml', () => {
  it('escapes markup', () => expect(plainTextToHtml('<script>alert("x")</script> & \'y\'')).toBe('<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;</p>'));
  it('turns line breaks into paragraphs', () => expect(plainTextToHtml('a\r\nb')).toBe('<p>a</p><p>b</p>'));
  it('keeps empty text empty', () => expect(plainTextToHtml('  ')).toBe(''));
});

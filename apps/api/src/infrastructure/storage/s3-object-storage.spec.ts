import { describe, expect, it } from 'vitest';
import { contentDisposition } from './content-disposition.js';

describe('contentDisposition', () => {
  it('quotes a plain name', () => {
    expect(contentDisposition('attachment', 'report.pdf')).toBe(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
  });

  it('keeps non-ASCII names in the UTF-8 form and replaces them in the fallback', () => {
    expect(contentDisposition('inline', 'informe año.pdf')).toBe(`inline; filename="informe a_o.pdf"; filename*=UTF-8''informe%20a%C3%B1o.pdf`);
  });

  it('cannot be broken out of with quotes, semicolons or percent signs', () => {
    const header = contentDisposition('attachment', 'a"; filename="b%.pdf');
    expect(header.startsWith('attachment; filename="a__ filename=_b_.pdf"')).toBe(true);
    expect(header).toContain(`filename*=UTF-8''a%22%3B%20filename%3D%22b%25.pdf`);
  });

  it('escapes the characters encodeURIComponent leaves alone', () => {
    expect(contentDisposition('attachment', "a'(b)*.pdf")).toContain(`filename*=UTF-8''a%27%28b%29%2A.pdf`);
  });
});

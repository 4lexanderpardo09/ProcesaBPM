import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvField, csvRecord, csvRow, jsonLine } from './export-encoding.js';

describe('jsonLine', () => {
  it('writes one JSON object per line with ISO dates and big integers as text', () => {
    expect(jsonLine({ id: 'a', number: 9007199254740993n, at: new Date('2026-10-04T10:00:00Z'), value: { amount: 1.5 }, none: null })).toBe(
      '{"id":"a","number":"9007199254740993","at":"2026-10-04T10:00:00.000Z","value":{"amount":1.5},"none":null}\n',
    );
  });

  it('keeps line breaks of the content inside the line', () => {
    expect(jsonLine({ text: 'a\nb' }).split('\n')).toHaveLength(2);
  });
});

describe('CSV', () => {
  it('starts with a UTF-8 byte order mark', () => {
    expect(Buffer.from(CSV_BOM, 'utf8')).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('quotes per RFC 4180 and ends rows with CRLF', () => {
    expect(csvRow(['plain', 'a,b', 'say "hi"', 'two\nlines', null, 3, true])).toBe('plain,"a,b","say ""hi""","two\nlines",,3,true\r\n');
  });

  it('neutralizes text a spreadsheet would run as a formula, and nothing else', () => {
    expect(csvField('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    for (const formula of ['+1', '-1+2', '@SUM(A1)', '\tx']) expect(csvField(formula).replace(/^"/, '').startsWith("'"), formula).toBe(true);
    expect(csvField(-5)).toBe('-5');
    expect(csvField('ok =1')).toBe('ok =1');
  });

  it('writes objects as JSON and dates in ISO 8601', () => {
    expect(csvField({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvField(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
  });

  it('follows the column order of the dataset', () => {
    expect(csvRecord({ b: 2, a: 1 }, ['a', 'b', 'c'])).toBe('1,2,\r\n');
  });
});

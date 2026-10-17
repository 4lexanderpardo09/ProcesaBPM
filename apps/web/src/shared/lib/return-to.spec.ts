import { describe, expect, it } from 'vitest';
import { sanitizeReturnTo } from './return-to';

const ORIGIN = 'https://app.procesabpm.com';

describe('sanitizeReturnTo', () => {
  it.each([
    ['/tickets', '/tickets'],
    ['/tickets?tab=assigned#top', '/tickets?tab=assigned#top'],
    ['/people/../tickets', '/tickets'],
    ['/a%0d%0ab', '/a%0d%0ab'],
  ])('keeps the app path %j', (raw, expected) => {
    expect(sanitizeReturnTo(raw, ORIGIN)).toBe(expected);
  });

  it.each([
    ['another origin', 'https://evil.com/tickets'],
    ['a protocol-relative URL', '//evil.com'],
    ['a backslash host', '/\\evil.com'],
    ['a script', 'javascript:alert(1)'],
    ['a leading tab', '\t/tickets'],
    ['an embedded newline', '/tickets\n'],
    ['a relative path', 'tickets'],
    ['the login page', '/login?returnTo=/tickets'],
    ['the forgot-password page', '/forgot-password'],
    ['an empty value', ''],
    ['null', null],
    ['undefined', undefined],
    ['a very long value', `/${'a'.repeat(3000)}`],
  ])('falls back to home for %s', (_label, raw) => {
    expect(sanitizeReturnTo(raw, ORIGIN)).toBe('/');
  });
});

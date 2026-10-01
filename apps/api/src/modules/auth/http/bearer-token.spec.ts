import { describe, expect, it } from 'vitest';
import { bearerToken } from './bearer-token.js';

describe('bearerToken', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc', 'abc'],
    ['  Bearer abc  ', 'abc'],
    ['Bearer abc==', 'abc=='],
    [undefined, undefined],
    ['', undefined],
    ['Bearer', undefined],
    ['Bearer ', undefined],
    ['Basic dXNlcjpwYXNz', undefined],
    ['Bearer two tokens', undefined],
    ['Bearer <script>', undefined],
  ])('%j → %j', (header, expected) => {
    expect(bearerToken(header)).toBe(expected);
  });
});

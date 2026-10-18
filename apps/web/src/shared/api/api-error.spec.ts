import { describe, expect, it } from 'vitest';
import { apiErrorFrom, parseRetryAfter } from './api-error';

const NOW = Date.parse('2026-10-17T12:00:00Z');

describe('parseRetryAfter', () => {
  it.each([
    ['120', 120],
    [' 5 ', 5],
    ['0', 0],
    ['Sat, 17 Oct 2026 12:01:30 GMT', 90],
    ['Sat, 17 Oct 2026 11:00:00 GMT', 0],
  ])('reads %j as %i seconds', (value, expected) => {
    expect(parseRetryAfter(value, NOW)).toBe(expected);
  });

  it.each([null, '', 'soon', '-5', '1.5'])('ignores %j', (value) => {
    expect(parseRetryAfter(value, NOW)).toBeUndefined();
  });
});

describe('apiErrorFrom', () => {
  it('carries the code, details and Retry-After of the response', () => {
    const body = { error: { code: 'RATE_LIMITED', message: 'Too many', requestId: 'r1', details: { a: 1 } } };
    const error = apiErrorFrom(429, body, new Headers({ 'Retry-After': '30' }), NOW);
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', requestId: 'r1', details: { a: 1 }, retryAfterSeconds: 30 });
  });

  it('keeps the status and Retry-After when the body is not the API format', () => {
    const error = apiErrorFrom(503, '<html>', new Headers({ 'Retry-After': '10' }), NOW);
    expect(error).toMatchObject({ status: 503, code: 'UNKNOWN_ERROR', retryAfterSeconds: 10 });
  });
});

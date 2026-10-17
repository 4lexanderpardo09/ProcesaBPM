import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './api-error';
import { shouldRetry } from './query-client';

const apiError = (status: number) => new ApiError(status, 'X', 'x', undefined, undefined);

describe('shouldRetry', () => {
  it.each([400, 401, 403, 404, 409, 422, 429])('does not retry a %i', (status) => {
    expect(shouldRetry(0, apiError(status))).toBe(false);
  });

  it('retries a 5xx and a network failure up to twice', () => {
    expect(shouldRetry(0, apiError(503))).toBe(true);
    expect(shouldRetry(1, new NetworkError(new TypeError()))).toBe(true);
    expect(shouldRetry(2, new NetworkError(new TypeError()))).toBe(false);
  });
});

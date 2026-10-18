import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './api-error';
import { genericErrorMessage } from './error-message';

describe('genericErrorMessage', () => {
  it('blames the connection when the API did not answer', () => {
    expect(genericErrorMessage(new NetworkError(new TypeError()))).toEqual({ key: 'errors.network' });
  });

  it('gives the reference of an API error', () => {
    expect(genericErrorMessage(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'x', requestId: 'req-9' }))).toEqual({
      key: 'errors.unexpectedWithReference',
      values: { requestId: 'req-9' },
    });
  });

  it('falls back to an unexpected error', () => {
    expect(genericErrorMessage(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'x' }))).toEqual({ key: 'errors.unexpected' });
    expect(genericErrorMessage(new TypeError('bug'))).toEqual({ key: 'errors.unexpected' });
  });
});

import { ERROR_CODES } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { HTTP_STATUS_BY_ERROR_CODE } from './error-status.js';

describe('HTTP_STATUS_BY_ERROR_CODE', () => {
  it('answers every domain error code', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(HTTP_STATUS_BY_ERROR_CODE[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it.each([
    [ERROR_CODES.immutableData, 409],
    [ERROR_CODES.invalidState, 422],
    [ERROR_CODES.invalidReference, 422],
    [ERROR_CODES.duplicate, 409],
    [ERROR_CODES.overlap, 409],
    [ERROR_CODES.permissionDenied, 403],
  ])('%s is answered with %i (docs/base-de-datos.md §8.5)', (code, status) => {
    expect(HTTP_STATUS_BY_ERROR_CODE[code]).toBe(status);
  });
});

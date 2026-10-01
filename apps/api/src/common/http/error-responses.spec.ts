import { ERROR_CODES } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { ERROR_RESPONSES } from './error-responses.js';

describe('ERROR_RESPONSES', () => {
  it('answers every domain error code with a status and a message', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(ERROR_RESPONSES[code].status).toBeGreaterThanOrEqual(400);
      expect(ERROR_RESPONSES[code].message).not.toBe('');
    }
  });

  it.each([
    [ERROR_CODES.immutableData, 409],
    [ERROR_CODES.invalidState, 422],
    [ERROR_CODES.invalidReference, 422],
    [ERROR_CODES.duplicate, 409],
    [ERROR_CODES.overlap, 409],
    [ERROR_CODES.permissionDenied, 403],
    [ERROR_CODES.unauthenticated, 401],
    [ERROR_CODES.invalidCredentials, 401],
    [ERROR_CODES.rateLimited, 429],
    [ERROR_CODES.validationFailed, 400],
    [ERROR_CODES.mfaNotImplemented, 501],
  ])('%s is answered with %i', (code, status) => {
    expect(ERROR_RESPONSES[code].status).toBe(status);
  });
});

import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/api';
import { adminErrorMessage } from './admin-error';

const apiError = (status: number, code: string) => new ApiError({ status, code, message: 'x' });

describe('adminErrorMessage', () => {
  it('names a taken name, a missing permission, refused data and a record that cannot change', () => {
    expect(adminErrorMessage(apiError(409, 'DUPLICATE'))).toEqual({ namespace: 'admin', key: 'errors.duplicate' });
    expect(adminErrorMessage(apiError(403, 'PERMISSION_DENIED'))).toEqual({ namespace: 'admin', key: 'errors.forbidden' });
    expect(adminErrorMessage(apiError(400, 'VALIDATION_FAILED'))).toEqual({ namespace: 'admin', key: 'errors.invalid' });
    expect(adminErrorMessage(apiError(422, 'INVALID_STATE'))).toEqual({ namespace: 'admin', key: 'errors.inUse' });
  });

  it('falls back to the generic message', () => {
    expect(adminErrorMessage(new Error('x'))).toEqual({ namespace: 'common', key: 'errors.unexpected' });
  });
});

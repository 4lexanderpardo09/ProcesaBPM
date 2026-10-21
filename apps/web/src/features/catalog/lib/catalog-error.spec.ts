import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/api';
import { catalogErrorMessage } from './catalog-error';

const apiError = (status: number, code: string) => new ApiError({ status, code, message: 'x' });

describe('catalogErrorMessage', () => {
  it('names a taken name, a missing permission, refused data and a record that cannot change', () => {
    expect(catalogErrorMessage(apiError(409, 'DUPLICATE'))).toEqual({ namespace: 'catalog', key: 'errors.duplicate' });
    expect(catalogErrorMessage(apiError(403, 'PERMISSION_DENIED'))).toEqual({ namespace: 'catalog', key: 'errors.forbidden' });
    expect(catalogErrorMessage(apiError(400, 'VALIDATION_FAILED'))).toEqual({ namespace: 'catalog', key: 'errors.invalid' });
    expect(catalogErrorMessage(apiError(422, 'INVALID_STATE'))).toEqual({ namespace: 'catalog', key: 'errors.inUse' });
  });

  it('falls back to the generic message', () => {
    expect(catalogErrorMessage(new Error('x'))).toEqual({ namespace: 'common', key: 'errors.unexpected' });
  });
});

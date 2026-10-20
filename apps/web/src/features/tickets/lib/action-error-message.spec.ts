import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/shared/api';
import { actionErrorMessage } from './action-error-message';

const apiError = (status: number, code: string) => new ApiError({ status, code, message: 'never shown', requestId: 'req-1' });

describe('actionErrorMessage', () => {
  it('explains a missing permission, a ticket that changed and a refused request', () => {
    expect(actionErrorMessage(apiError(403, 'PERMISSION_DENIED'))).toEqual({ namespace: 'tickets', key: 'actions.errors.forbidden' });
    expect(actionErrorMessage(apiError(409, 'IMMUTABLE_DATA'))).toEqual({ namespace: 'tickets', key: 'actions.errors.changed' });
    expect(actionErrorMessage(apiError(422, 'INVALID_STATE'))).toEqual({ namespace: 'tickets', key: 'actions.errors.changed' });
    expect(actionErrorMessage(apiError(422, 'FIELD_VALUES_INVALID'))).toEqual({ namespace: 'tickets', key: 'actions.errors.rejected' });
  });

  it('falls back to the generic message, with its reference', () => {
    expect(actionErrorMessage(apiError(500, 'INTERNAL'))).toEqual({ namespace: 'common', key: 'errors.unexpectedWithReference', values: { requestId: 'req-1' } });
    expect(actionErrorMessage(new NetworkError(new TypeError('offline')))).toEqual({ namespace: 'common', key: 'errors.network' });
  });
});

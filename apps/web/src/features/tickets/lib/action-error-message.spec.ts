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
    expect(actionErrorMessage(apiError(422, 'ASSIGNEE_SELECTION_REQUIRED'))).toEqual({ namespace: 'tickets', key: 'actions.errors.assigneeRequired' });
    expect(actionErrorMessage(apiError(422, 'NO_ASSIGNEE_CANDIDATES'))).toEqual({ namespace: 'tickets', key: 'actions.errors.noCandidates' });
  });

  it('shows the messages written for the amount limits that blocked the request', () => {
    const blocked = new ApiError({ status: 422, code: 'AMOUNT_LIMIT_EXCEEDED', message: 'never shown', requestId: 'req-1', details: { messages: ['Un viaje no puede pasar de 20 millones', ''] } });
    expect(actionErrorMessage(blocked)).toEqual({ namespace: 'tickets', key: 'actions.errors.amountLimit', values: { messages: 'Un viaje no puede pasar de 20 millones' } });
    expect(actionErrorMessage(apiError(422, 'AMOUNT_LIMIT_EXCEEDED'))).toEqual({ namespace: 'tickets', key: 'actions.errors.amountLimit', values: { messages: '' } });
  });

  it('falls back to the generic message, with its reference', () => {
    expect(actionErrorMessage(apiError(500, 'INTERNAL'))).toEqual({ namespace: 'common', key: 'errors.unexpectedWithReference', values: { requestId: 'req-1' } });
    expect(actionErrorMessage(new NetworkError(new TypeError('offline')))).toEqual({ namespace: 'common', key: 'errors.network' });
  });
});

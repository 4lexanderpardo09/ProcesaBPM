import { describe, expect, it } from 'vitest';
import { ApiError } from '@/shared/api';
import { assigneeChoicesOf } from './assignee-choices';

const selectionRequired = (details: unknown) => new ApiError({ status: 422, code: 'ASSIGNEE_SELECTION_REQUIRED', message: 'x', details });

describe('assigneeChoicesOf', () => {
  it('lists the candidates the API offers for the next step', () => {
    const error = selectionRequired({ stepId: 's', candidates: [{ userId: 'u1', name: 'Luis Gómez' }, { userId: 'u2', name: 'Marta Ruiz' }] });
    expect(assigneeChoicesOf(error)).toEqual([
      { id: 'u1', name: 'Luis Gómez' },
      { id: 'u2', name: 'Marta Ruiz' },
    ]);
  });

  it('skips malformed candidates and gives an empty list without them', () => {
    expect(assigneeChoicesOf(selectionRequired({ candidates: [{ userId: 1, name: 'x' }, { userId: 'u2', name: 'Marta Ruiz' }] }))).toEqual([{ id: 'u2', name: 'Marta Ruiz' }]);
    expect(assigneeChoicesOf(selectionRequired(undefined))).toEqual([]);
  });

  it('is undefined for any other error', () => {
    expect(assigneeChoicesOf(new ApiError({ status: 422, code: 'FIELD_VALUES_INVALID', message: 'x' }))).toBeUndefined();
    expect(assigneeChoicesOf(new Error('x'))).toBeUndefined();
  });
});

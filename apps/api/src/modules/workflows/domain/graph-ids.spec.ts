import { InvalidReferenceError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { countNewRefs, resolveReferences } from './graph-ids.js';

const A = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
const B = '018f3c1e-7b2a-7c3d-9e4f-0123456789ac';

describe('resolveReferences', () => {
  it('keeps existing ids and allocates the new ones in order', () => {
    const resolved = resolveReferences([A, 'new:first', 'new:second'], new Set([A]), ['id-1', 'id-2'], 'block');
    expect([...resolved]).toEqual([[A, A], ['new:first', 'id-1'], ['new:second', 'id-2']]);
  });

  it('refuses an id that is not of the version', () => {
    expect(() => resolveReferences([B], new Set([A]), [], 'block')).toThrow(InvalidReferenceError);
  });

  it('counts the new references', () => {
    expect(countNewRefs([A, 'new:a', 'new:b'])).toBe(2);
  });
});

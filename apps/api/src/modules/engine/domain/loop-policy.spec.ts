import { MaxLoopsReachedError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { nextLoop } from './loop-policy.js';

describe('nextLoop', () => {
  it('starts at 1 and goes up from the highest visit', () => {
    expect(nextLoop([], null, 's')).toBe(1);
    expect(nextLoop([1, 3, 2], null, 's')).toBe(4);
  });
  it('allows up to max_loops visits and refuses the next one', () => {
    expect(nextLoop([1, 2], 3, 's')).toBe(3);
    expect(() => nextLoop([1, 2, 3], 3, 's')).toThrow(MaxLoopsReachedError);
  });
});

import { describe, expect, it } from 'vitest';
import { cx } from './cx';

describe('cx', () => {
  it('joins only the class names that are set', () => {
    expect(cx('button', undefined, 'primary', false, null, '')).toBe('button primary');
  });

  it('returns an empty string when none is set', () => {
    expect(cx(undefined, false)).toBe('');
  });
});

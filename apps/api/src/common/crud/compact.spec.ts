import { describe, expect, it } from 'vitest';
import { compact } from './compact.js';

describe('compact', () => {
  it('drops undefined but keeps null, false, zero and empty strings', () => {
    expect(compact({ a: undefined, b: null, c: false, d: 0, e: '' })).toEqual({ b: null, c: false, d: 0, e: '' });
  });
});

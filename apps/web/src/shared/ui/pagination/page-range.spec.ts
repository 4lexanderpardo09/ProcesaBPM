import { describe, expect, it } from 'vitest';
import { pageRange } from './page-range';

describe('pageRange', () => {
  it('covers the items of a middle page', () => {
    expect(pageRange(2, 25, 80)).toEqual({ from: 26, to: 50, pageCount: 4, hasPrevious: true, hasNext: true });
  });

  it('stops at the total on the last page', () => {
    expect(pageRange(4, 25, 80)).toEqual({ from: 76, to: 80, pageCount: 4, hasPrevious: true, hasNext: false });
  });

  it('shows zero items when there are none', () => {
    expect(pageRange(1, 25, 0)).toEqual({ from: 0, to: 0, pageCount: 1, hasPrevious: false, hasNext: false });
  });

  it('does not run past the total on a page beyond the last one', () => {
    expect(pageRange(9, 25, 30)).toMatchObject({ from: 30, to: 30, hasNext: false });
  });
});

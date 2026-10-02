import { describe, expect, it } from 'vitest';
import type { PageBox } from '@procesabpm/shared';
import { toUserSpace } from './page-geometry.js';

const box = (rotation: PageBox['rotation'], x = 0, y = 0): PageBox => ({ mediaBox: { x, y, w: 600, h: 800 }, rotation });

describe('toUserSpace', () => {
  it.each([
    [0, { x: 10, y: 20, rotate: 0 }],
    [90, { x: 580, y: 10, rotate: 90 }],
    [180, { x: 590, y: 780, rotate: 180 }],
    [270, { x: 20, y: 790, rotate: 270 }],
  ] as const)('a page shown rotated %i degrees', (rotation, expected) => {
    expect(toUserSpace(box(rotation), 10, 20)).toEqual(expected);
  });

  it('adds the offset of a media box that does not start at the origin', () => {
    expect(toUserSpace(box(0, 5, 7), 10, 20)).toEqual({ x: 15, y: 27, rotate: 0 });
  });

  it('the bottom-left corner of a page shown rotated 90 degrees is the bottom-right corner of the page itself', () => {
    expect(toUserSpace(box(90), 0, 0)).toMatchObject({ x: 600, y: 0 });
  });
});

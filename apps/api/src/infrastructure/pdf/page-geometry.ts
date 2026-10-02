import type { PageBox } from '@procesabpm/shared';

/**
 * A point of the page as people see it (origin at the bottom-left of the displayed page) in the page's own coordinates
 * (what PDF operators use), for a page shown rotated by `rotation` degrees clockwise. `rotate` is the angle, counter-clockwise,
 * that text must be turned by to read upright on the displayed page.
 */
export function toUserSpace(box: PageBox, u: number, v: number): { x: number; y: number; rotate: number } {
  const { x: x0, y: y0, w, h } = box.mediaBox;
  switch (box.rotation) {
    case 90:
      return { x: x0 + w - v, y: y0 + u, rotate: 90 };
    case 180:
      return { x: x0 + w - u, y: y0 + h - v, rotate: 180 };
    case 270:
      return { x: x0 + v, y: y0 + h - u, rotate: 270 };
    default:
      return { x: x0 + u, y: y0 + v, rotate: 0 };
  }
}

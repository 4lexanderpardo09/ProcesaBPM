import { type CanvasElement, canvasElementSchema } from '@procesabpm/shared';
import { z } from 'zod';

const KEY = 'procesabpm.canvas.clipboard';
const copiedSchema = z.array(canvasElementSchema).min(1).max(200);

/**
 * The elements copied in the canvas designer. It lives in the browser, so they can be pasted on another sheet or another
 * format, even of another workflow (whatever names a field or an image it lacks shows up in the problems).
 * Storage can be unavailable (a private window, blocked site data): copying then lasts only for this page.
 */
let inMemory: CanvasElement[] | null = null;

export function copyElements(elements: readonly CanvasElement[]): void {
  inMemory = [...elements];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(elements));
  } catch {
    // Kept in memory only.
  }
}

export function copiedElements(): CanvasElement[] | null {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored !== null) {
      const parsed = copiedSchema.safeParse(JSON.parse(stored));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Falls back to what this page copied.
  }
  return inMemory;
}

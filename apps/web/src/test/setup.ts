import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@/i18n';

/**
 * The first render of a test file loads its lazy page; under a full parallel run that can take more than Testing
 * Library's default second, and `findBy…` failed at random. Three seconds is still short for a real failure.
 */
configure({ asyncUtilTimeout: 3000 });

/** jsdom has no layout: React Flow (the workflow diagrams) needs these to mount, as its testing guide shows. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class DOMMatrixReadOnlyStub {
  readonly m22: number;
  constructor(transform?: string) {
    const scale = /scale\(([\d.]+)\)/.exec(transform ?? '')?.[1];
    this.m22 = scale === undefined ? 1 : Number(scale);
  }
}

globalThis.ResizeObserver ??= ResizeObserverStub;
globalThis.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;

/** jsdom has `<dialog>` without its modal methods: open and close it as the browser would (no inert page, no Escape). */
if (HTMLDialogElement.prototype.showModal === undefined) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

/** jsdom has no layout: ProseMirror (the text editor) measures ranges and asks what is under a point to scroll the cursor into view. */
const NO_RECTS = (): DOMRectList => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects ??= NO_RECTS;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
(Text.prototype as Text & { getClientRects?: () => DOMRectList }).getClientRects ??= NO_RECTS;
document.elementFromPoint ??= () => null;

afterEach(() => {
  cleanup();
});

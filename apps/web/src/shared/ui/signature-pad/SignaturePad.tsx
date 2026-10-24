import { type PointerEvent, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import styles from './SignaturePad.module.css';

/** What the parent can ask the pad. */
export interface SignaturePadHandle {
  /** The drawing as a PNG on white, or `null` while nothing is drawn. */
  toBlob(): Promise<Blob | null>;
  clear(): void;
}

export interface SignaturePadProps {
  /** Names the drawing area for screen readers (it has no text of its own). */
  readonly label: string;
  /** Whether something is drawn, as it changes. */
  readonly onInkChange?: (hasInk: boolean) => void;
  readonly ref?: Ref<SignaturePadHandle>;
}

const WIDTH = 480;
const HEIGHT = 180;
const LINE = 2.4;

/**
 * A box to sign in with the mouse, a pen or a finger (pointer events): smooth strokes on a white background, sharp on
 * high-density screens, exported as a PNG the PDF documents can embed. The parent clears it and reads it by `ref`.
 */
export function SignaturePad({ label, onInkChange, ref }: SignaturePadProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const paintBackground = () => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (element == null || context == null) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, element.width, element.height);
    const scale = element.width / WIDTH;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = LINE;
    context.strokeStyle = '#111827';
  };

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
    element.width = WIDTH * ratio;
    element.height = HEIGHT * ratio;
    paintBackground();
  }, []);

  const changeInk = (next: boolean) => {
    setHasInk(next);
    onInkChange?.(next);
  };

  useImperativeHandle(ref, () => ({
    toBlob: () => new Promise((resolve) => (hasInk && canvas.current !== null ? canvas.current.toBlob((blob) => resolve(blob), 'image/png') : resolve(null))),
    clear: () => {
      paintBackground();
      changeInk(false);
    },
  }));

  const pointOf = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * WIDTH, y: ((event.clientY - box.top) / box.height) * HEIGHT };
  };

  return (
    <canvas
      ref={canvas}
      className={styles.pad}
      role="img"
      aria-label={label}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = pointOf(event);
        const context = event.currentTarget.getContext('2d');
        if (context === null) return;
        // A tap leaves a dot.
        context.beginPath();
        context.arc(drawing.current.x, drawing.current.y, LINE / 2, 0, Math.PI * 2);
        context.fillStyle = '#111827';
        context.fill();
        if (!hasInk) changeInk(true);
      }}
      onPointerMove={(event) => {
        const from = drawing.current;
        const context = event.currentTarget.getContext('2d');
        if (from === null || context === null) return;
        const to = pointOf(event);
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
        drawing.current = to;
      }}
      onPointerUp={() => (drawing.current = null)}
      onPointerCancel={() => (drawing.current = null)}
    />
  );
}

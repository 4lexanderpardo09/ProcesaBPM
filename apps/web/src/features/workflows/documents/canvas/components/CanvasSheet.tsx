import type { CanvasElement, CanvasElementType, PdfCanvasDesign } from '@procesabpm/shared';
import { type DragEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Box, boundsOf, boxOf, type Guide, isOnSheet, PX_PER_MM, roundMm, sheetSizeOf, snap } from '../lib/canvas-doc';
import { cssOf } from '../lib/canvas-css';
import { ElementView } from './ElementView';
import styles from './Canvas.module.css';

/** What the palette drags onto the sheet: a tool, or a field of the form. */
export type Droppable = { readonly tool: CanvasElementType } | { readonly field: string };
export const DROP_MIME = 'application/x-procesabpm-canvas';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSOR: Readonly<Record<Handle, string>> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
/** A press that moves less than this many screen pixels is a click, not a drag. */
const CLICK_SLOP_PX = 3;
const MIN_SIZE_MM = 1;

type Drag =
  | { mode: 'move'; x0: number; y0: number; originals: Map<string, Box>; moved: boolean }
  | { mode: 'resize'; x0: number; y0: number; handle: Handle; original: Box; id: string }
  | { mode: 'marquee'; x0: number; y0: number; x1: number; y1: number; add: readonly string[] };

export interface CanvasSheetProps {
  readonly design: PdfCanvasDesign;
  /** The sheet of the design being edited. */
  readonly sheet: number;
  readonly zoom: number;
  readonly selection: readonly string[];
  readonly onSelect: (ids: string[]) => void;
  readonly grid: number | null;
  readonly showGrid: boolean;
  readonly readOnly: boolean;
  /** A change while dragging: no history step yet. */
  readonly onPreview: (update: (design: PdfCanvasDesign) => PdfCanvasDesign) => void;
  /** The drag ended: one history step. */
  readonly onCommit: () => void;
  /** A change with its own history step (`key` merges quick changes of the same thing). */
  readonly onChange: (update: (design: PdfCanvasDesign) => PdfCanvasDesign, key?: string) => void;
  readonly onDrop: (droppable: Droppable, x: number, y: number) => void;
}

/**
 * The sheet of the editor: elements are dragged and resized, snap to the grid and to the edges and centres of the
 * others (with guides; Alt turns it off), are picked with a click, Shift+click or a marquee, and tools and fields are
 * dropped onto it from the palette. A double click edits a text in place.
 */
export function CanvasSheet({ design, sheet, zoom, selection, onSelect, grid, showGrid, readOnly, onPreview, onCommit, onChange, onDrop }: CanvasSheetProps) {
  const { t } = useTranslation('workflows');
  const size = sheetSizeOf(design);
  const scale = PX_PER_MM * zoom;
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const visible = design.elements.filter((element) => isOnSheet(element, sheet));

  const toMm = useCallback(
    (clientX: number, clientY: number) => {
      const rect = sheetRef.current!.getBoundingClientRect();
      return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
    },
    [scale],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (current === null) return;
      const point = toMm(event.clientX, event.clientY);
      const [dx, dy] = [point.x - current.x0, point.y - current.y0];

      if (current.mode === 'marquee') {
        current.x1 = point.x;
        current.y1 = point.y;
        setMarquee({ x: Math.min(current.x0, point.x), y: Math.min(current.y0, point.y), width: Math.abs(dx), height: Math.abs(dy) });
        return;
      }
      if (current.mode === 'move') {
        if (!current.moved && Math.hypot(dx, dy) * scale < CLICK_SLOP_PX) return;
        current.moved = true;
        const bounds = boundsOf([...current.originals.values()]);
        const others = visible.filter((element) => !current.originals.has(element.id)).map(boxOf);
        const pull = event.altKey ? { dx: 0, dy: 0, guides: [] } : snap({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, others, size, 5 / scale + 0.5, grid);
        setGuides(pull.guides);
        onPreview((previous) => ({
          ...previous,
          elements: previous.elements.map((element) => {
            const original = current.originals.get(element.id);
            return original === undefined ? element : { ...element, x: roundMm(original.x + dx + pull.dx), y: roundMm(original.y + dy + pull.dy) };
          }),
        }));
        return;
      }
      const { original, handle } = current;
      const toGrid = (value: number) => (grid !== null && !event.altKey ? Math.round(value / grid) * grid : value);
      let { x, y, width, height } = original;
      if (handle.includes('e')) width = toGrid(original.x + original.width + dx) - original.x;
      if (handle.includes('w')) {
        x = toGrid(original.x + dx);
        width = original.x + original.width - x;
      }
      if (handle.includes('s')) height = toGrid(original.y + original.height + dy) - original.y;
      if (handle.includes('n')) {
        y = toGrid(original.y + dy);
        height = original.y + original.height - y;
      }
      if (event.shiftKey && handle.length === 2) {
        // Shift keeps the proportion from a corner.
        const ratio = original.width / original.height;
        if (width / height > ratio) width = height * ratio;
        else height = width / ratio;
        if (handle.includes('w')) x = original.x + original.width - width;
        if (handle.includes('n')) y = original.y + original.height - height;
      }
      if (width < MIN_SIZE_MM) {
        if (handle.includes('w')) x = original.x + original.width - MIN_SIZE_MM;
        width = MIN_SIZE_MM;
      }
      if (height < MIN_SIZE_MM) {
        if (handle.includes('n')) y = original.y + original.height - MIN_SIZE_MM;
        height = MIN_SIZE_MM;
      }
      onPreview((previous) => ({ ...previous, elements: previous.elements.map((element) => (element.id === current.id ? { ...element, x: roundMm(x), y: roundMm(y), width: roundMm(width), height: roundMm(height) } : element)) }));
    };

    const onUp = () => {
      const current = drag.current;
      drag.current = null;
      setGuides([]);
      if (current === null) return;
      if (current.mode === 'marquee') {
        setMarquee(null);
        const box = { x: Math.min(current.x0, current.x1), y: Math.min(current.y0, current.y1), width: Math.abs(current.x1 - current.x0), height: Math.abs(current.y1 - current.y0) };
        if (box.width < 1 && box.height < 1) return onSelect([...current.add]);
        const inside = visible.filter((element) => element.x < box.x + box.width && element.x + element.width > box.x && element.y < box.y + box.height && element.y + element.height > box.y).map((element) => element.id);
        onSelect([...new Set([...current.add, ...inside])]);
        return;
      }
      onCommit();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [grid, onCommit, onPreview, onSelect, scale, size, toMm, visible]);

  const pressElement = (event: ReactPointerEvent, element: CanvasElement) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (editing === element.id) return;
    let ids = [...selection];
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      onSelect(selection.includes(element.id) ? selection.filter((id) => id !== element.id) : [...selection, element.id]);
      return;
    }
    if (!selection.includes(element.id)) {
      ids = [element.id];
      onSelect(ids);
    }
    if (readOnly) return;
    const movable = design.elements.filter((candidate) => ids.includes(candidate.id) && !candidate.locked);
    if (movable.length === 0) return;
    const point = toMm(event.clientX, event.clientY);
    drag.current = { mode: 'move', x0: point.x, y0: point.y, originals: new Map(movable.map((candidate) => [candidate.id, boxOf(candidate)])), moved: false };
  };

  const pressHandle = (event: ReactPointerEvent, element: CanvasElement, handle: Handle) => {
    event.stopPropagation();
    const point = toMm(event.clientX, event.clientY);
    drag.current = { mode: 'resize', x0: point.x, y0: point.y, handle, original: boxOf(element), id: element.id };
  };

  const pressSheet = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    setEditing(null);
    const point = toMm(event.clientX, event.clientY);
    drag.current = { mode: 'marquee', x0: point.x, y0: point.y, x1: point.x, y1: point.y, add: event.shiftKey ? selection : [] };
  };

  const drop = (event: DragEvent) => {
    const raw = event.dataTransfer.getData(DROP_MIME);
    if (raw === '' || readOnly) return;
    event.preventDefault();
    const point = toMm(event.clientX, event.clientY);
    try {
      onDrop(JSON.parse(raw) as Droppable, point.x, point.y);
    } catch {
      // Something else was dropped.
    }
  };

  const single = selection.length === 1 ? visible.find((element) => element.id === selection[0]) : undefined;
  const limit = size.height - design.page.marginBottom;
  const gridBackground = showGrid && grid !== null ? { backgroundSize: `${Math.max(grid, 5) * scale}px ${Math.max(grid, 5) * scale}px` } : undefined;

  return (
    <div
      ref={sheetRef}
      className={`${styles.sheet} ${gridBackground === undefined ? '' : styles.grid}`}
      style={{ width: size.width * scale, height: size.height * scale, ...gridBackground }}
      role="application"
      aria-label={t('documents.canvas.sheetLabel')}
      onPointerDown={pressSheet}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(DROP_MIME)) event.preventDefault();
      }}
      onDrop={drop}
    >
      <div className={styles.limit} style={{ top: limit * scale }}>
        <span>{t('documents.canvas.limit')}</span>
      </div>

      {visible.map((element) => {
        const selected = selection.includes(element.id);
        return (
          <div
            key={element.id}
            data-element={element.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={t('documents.canvas.elementLabel', { name: element.name || t(`documents.canvas.tools.${element.type}`) })}
            className={styles.element}
            data-selected={selected || undefined}
            data-locked={element.locked || undefined}
            style={{ left: element.x * scale, top: element.y * scale, width: element.width * scale, height: element.height * scale }}
            onPointerDown={(event) => pressElement(event, element)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect([element.id]);
              }
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (element.type === 'text' && !element.locked && !readOnly) setEditing(element.id);
            }}
          >
            {editing === element.id && element.type === 'text' ? (
              <textarea
                autoFocus
                className={styles.inlineEditor}
                aria-label={t('documents.canvas.props.content')}
                style={{ ...cssOf(element.style, zoom), background: element.style.background ?? 'rgba(255,255,255,.92)' }}
                value={element.content}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Escape') setEditing(null);
                }}
                onBlur={() => setEditing(null)}
                onChange={(event) => {
                  const content = event.target.value;
                  onChange((previous) => ({ ...previous, elements: previous.elements.map((candidate) => (candidate.id === element.id && candidate.type === 'text' ? { ...candidate, content } : candidate)) }), `content-${element.id}`);
                }}
              />
            ) : (
              <div className={styles.view}>
                <ElementView element={element} zoom={zoom} />
              </div>
            )}
            {element.repeat && (
              <span className={styles.badgeRepeat} title={t('documents.canvas.repeatsHint')}>
                ↻
              </span>
            )}
            {element.condition !== '' && (
              <span className={styles.badgeCondition} title={t('documents.canvas.conditionHint', { condition: element.condition })}>
                {t('documents.canvas.conditionBadge')}
              </span>
            )}
          </div>
        );
      })}

      {single !== undefined &&
        !single.locked &&
        !readOnly &&
        editing !== single.id &&
        HANDLES.map((handle) => {
          const cx = handle.includes('w') ? 0 : handle.includes('e') ? 1 : 0.5;
          const cy = handle.includes('n') ? 0 : handle.includes('s') ? 1 : 0.5;
          return <div key={handle} className={styles.handle} style={{ left: (single.x + single.width * cx) * scale, top: (single.y + single.height * cy) * scale, cursor: CURSOR[handle] }} onPointerDown={(event) => pressHandle(event, single, handle)} />;
        })}

      {guides.map((guide, index) =>
        guide.axis === 'x' ? <div key={index} className={styles.guideX} style={{ left: guide.at * scale }} /> : <div key={index} className={styles.guideY} style={{ top: guide.at * scale }} />,
      )}
      {marquee !== null && <div className={styles.marquee} style={{ left: marquee.x * scale, top: marquee.y * scale, width: marquee.width * scale, height: marquee.height * scale }} />}
    </div>
  );
}

import type { TemplateMapping } from '@procesabpm/shared';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LoadedPdf } from '@/shared/lib/pdf-pages';
import { Button } from '@/shared/ui';
import { type ItemRef, sameItem } from '../../lib/mapping-doc';
import styles from './Mapping.module.css';

export interface PageCanvasProps {
  readonly pdf: LoadedPdf;
  readonly mapping: TemplateMapping;
  readonly selected: ItemRef | undefined;
  /** The selected item waits for a click on the page. */
  readonly placing: boolean;
  readonly labelOf: (item: ItemRef) => string;
  readonly onSelect: (item: ItemRef) => void;
  readonly onPlace: (page: number, x: number, y: number) => void;
  readonly pageNumber: number;
  readonly onPageChange: (page: number) => void;
}

/** The PDF page as people see it, sized to the pane, with what is placed on it; a click places the selected item. */
export function PageCanvas({ pdf, mapping, selected, placing, labelOf, onSelect, onPlace, pageNumber, onPageChange }: PageCanvasProps) {
  const { t } = useTranslation('workflows');
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const page = pdf.pages[pageNumber - 1]!;
  const scale = width === 0 ? 0 : width / page.width;

  useEffect(() => {
    const element = frame.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (canvas.current === null || scale === 0) return;
    setFailed(false);
    pdf.render(pageNumber, canvas.current, scale).catch(() => setFailed(true));
  }, [pdf, pageNumber, scale]);

  const click = (event: MouseEvent<HTMLDivElement>) => {
    if (!placing || scale === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPlace(pageNumber, (event.clientX - rect.left) / scale, page.height - (event.clientY - rect.top) / scale);
  };

  const markers = [
    ...mapping.fields.map((field, index) => ({ ref: { kind: 'fields' as const, index }, item: field, box: undefined })),
    ...mapping.signatures.map((slot, index) => ({ ref: { kind: 'signatures' as const, index }, item: slot, box: slot.mode === 'COORDINATES' ? { width: slot.width ?? 0, height: slot.height ?? 0 } : undefined })),
  ].filter((marker) => marker.item.mode === 'COORDINATES' && marker.item.page === pageNumber);

  return (
    <section className={styles.viewer} aria-labelledby="mapping-page-title">
      <header className={styles.viewerHeader}>
        <h2 id="mapping-page-title" className={styles.title}>
          {t('documents.mapping.page', { page: pageNumber, pages: pdf.pages.length })}
        </h2>
        <div className={styles.pager}>
          <Button variant="ghost" disabled={pageNumber === 1} onClick={() => onPageChange(pageNumber - 1)}>
            {t('documents.mapping.previous')}
          </Button>
          <Button variant="ghost" disabled={pageNumber === pdf.pages.length} onClick={() => onPageChange(pageNumber + 1)}>
            {t('documents.mapping.next')}
          </Button>
        </div>
      </header>
      <p className={styles.note} role="status">
        {placing ? t('documents.mapping.clickToPlace', { item: selected === undefined ? '' : labelOf(selected) }) : t('documents.mapping.viewerHint')}
      </p>
      {failed && <p className={styles.error}>{t('documents.mapping.renderFailed')}</p>}
      <div ref={frame} className={styles.frame}>
        <div className={styles.sheet} data-placing={placing || undefined} style={{ width: page.width * scale, height: page.height * scale }} onClick={click}>
          <canvas ref={canvas} className={styles.canvas} aria-label={t('documents.mapping.canvas', { page: pageNumber })} />
          {markers.map(({ ref, item, box }) => {
            const x = (item.x ?? 0) * scale;
            const y = (page.height - (item.y ?? 0)) * scale;
            const active = sameItem(ref, selected);
            return (
              <button
                key={`${ref.kind}-${String(ref.index)}`}
                type="button"
                className={box === undefined ? styles.pin : styles.box}
                aria-label={t('documents.mapping.marker', { item: labelOf(ref) })}
                data-active={active || undefined}
                style={box === undefined ? { left: x, top: y } : { left: x, top: y - box.height * scale, width: box.width * scale, height: box.height * scale }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(ref);
                }}
              >
                <span className={styles.pinLabel} aria-hidden="true">
                  {labelOf(ref)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

import type { PdfCanvasDesign } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { isOnSheet } from '../lib/canvas-doc';
import styles from './Canvas.module.css';

export interface LayersPanelProps {
  readonly design: PdfCanvasDesign;
  readonly sheet: number;
  readonly selection: readonly string[];
  readonly problems: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onSelect: (ids: string[]) => void;
  readonly onLayer: (id: string, to: 1 | -1) => void;
  readonly onToggleLock: (id: string) => void;
}

/** The elements of the sheet, the one drawn on top first: to pick one under another, reorder or lock them. */
export function LayersPanel({ design, sheet, selection, problems, disabled, onSelect, onLayer, onToggleLock }: LayersPanelProps) {
  const { t } = useTranslation('workflows');
  const layers = design.elements.map((element, index) => ({ element, index })).filter(({ element }) => isOnSheet(element, sheet)).reverse();
  return (
    <section className={styles.panel} aria-labelledby="canvas-layers">
      <h2 id="canvas-layers" className={styles.panelTitle}>
        {t('documents.canvas.layersTitle')}
      </h2>
      {layers.length === 0 ? (
        <p className={styles.note}>{t('documents.canvas.noLayers')}</p>
      ) : (
        <ul className={styles.layers}>
          {layers.map(({ element, index }) => {
            const name = element.name || t(`documents.canvas.tools.${element.type}`);
            return (
              <li key={element.id} className={styles.layer} data-selected={selection.includes(element.id) || undefined}>
                <button type="button" className={styles.layerName} aria-pressed={selection.includes(element.id)} onClick={(event) => onSelect(event.shiftKey ? [...new Set([...selection, element.id])] : [element.id])}>
                  {problems.has(element.id) && '⚠ '}
                  {name} <span className={styles.layerType}>· {t(`documents.canvas.tools.${element.type}`)}</span>
                </button>
                <button type="button" className={styles.iconButton} disabled={disabled || index === design.elements.length - 1} aria-label={t('documents.canvas.layerUp', { name })} onClick={() => onLayer(element.id, 1)}>
                  ↑
                </button>
                <button type="button" className={styles.iconButton} disabled={disabled || index === 0} aria-label={t('documents.canvas.layerDown', { name })} onClick={() => onLayer(element.id, -1)}>
                  ↓
                </button>
                <button type="button" className={styles.iconButton} disabled={disabled} aria-pressed={element.locked} aria-label={t('documents.canvas.lockNamed', { name })} onClick={() => onToggleLock(element.id)}>
                  {element.locked ? '🔒' : '🔓'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

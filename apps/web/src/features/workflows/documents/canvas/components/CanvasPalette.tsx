import type { CanvasElementType, WorkflowVersionDocument } from '@procesabpm/shared';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DROP_MIME, type Droppable } from './CanvasSheet';
import styles from './Canvas.module.css';

export const CANVAS_TOOLS: readonly CanvasElementType[] = ['text', 'table', 'image', 'rectangle', 'line', 'signature'];

export interface CanvasPaletteProps {
  readonly document: WorkflowVersionDocument;
  readonly disabled: boolean;
  /** A click adds it in the middle of the visible sheet; dragging drops it where it is let go. */
  readonly onAdd: (droppable: Droppable) => void;
}

const startDrag = (event: DragEvent, droppable: Droppable) => {
  event.dataTransfer.setData(DROP_MIME, JSON.stringify(droppable));
  event.dataTransfer.effectAllowed = 'copy';
};

/** The tools and the fields of the form, to drag onto the sheet or add with a click. */
export function CanvasPalette({ document, disabled, onAdd }: CanvasPaletteProps) {
  const { t } = useTranslation('workflows');
  return (
    <section className={styles.panel} aria-labelledby="canvas-tools">
      <h2 id="canvas-tools" className={styles.panelTitle}>
        {t('documents.canvas.toolsTitle')}
      </h2>
      <ul className={styles.tools}>
        {CANVAS_TOOLS.map((tool) => (
          <li key={tool}>
            <button type="button" className={styles.tool} disabled={disabled} draggable={!disabled} title={t(`documents.canvas.toolHints.${tool}`)} onDragStart={(event) => startDrag(event, { tool })} onClick={() => onAdd({ tool })}>
              {t(`documents.canvas.tools.${tool}`)}
            </button>
          </li>
        ))}
      </ul>
      <h2 className={styles.panelTitle}>{t('documents.canvas.fieldsTitle')}</h2>
      {document.fields.length === 0 ? (
        <p className={styles.note}>{t('documents.canvas.noFields')}</p>
      ) : (
        <ul className={styles.fieldList}>
          {document.fields.map((field) => (
            <li key={field.code}>
              <button
                type="button"
                className={styles.fieldItem}
                disabled={disabled}
                draggable={!disabled}
                title={t('documents.canvas.addField', { name: field.label })}
                aria-label={t('documents.canvas.addField', { name: field.label })}
                onDragStart={(event) => startDrag(event, { field: field.code })}
                onClick={() => onAdd({ field: field.code })}
              >
                {field.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.note}>{t('documents.canvas.paletteHint')}</p>
    </section>
  );
}

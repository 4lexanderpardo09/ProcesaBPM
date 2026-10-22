import type { PdfCanvasDesign } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { MAX_SHEETS } from '../lib/canvas-doc';
import styles from './Canvas.module.css';

export interface SheetTabsProps {
  readonly design: PdfCanvasDesign;
  readonly sheet: number;
  readonly disabled: boolean;
  readonly onPick: (sheet: number) => void;
  readonly onAdd: () => void;
}

/** The sheets of the design (annexes, backs): each one starts on a new page of the PDF. */
export function SheetTabs({ design, sheet, disabled, onPick, onAdd }: SheetTabsProps) {
  const { t } = useTranslation('workflows');
  return (
    <div className={styles.sheets}>
      <div role="tablist" aria-label={t('documents.canvas.sheetsLabel')} className={styles.sheets}>
        {design.sheets.map((entry, index) => (
          <button key={index} type="button" role="tab" aria-selected={index === sheet} className={styles.sheetTab} onClick={() => onPick(index)}>
            {entry.name || t('documents.canvas.sheetName', { number: index + 1 })}
            {entry.condition !== '' && ' ⁂'}
          </button>
        ))}
      </div>
      {!disabled && design.sheets.length < MAX_SHEETS && (
        <button type="button" className={styles.sheetTab} onClick={onAdd}>
          + {t('documents.canvas.addSheet')}
        </button>
      )}
    </div>
  );
}

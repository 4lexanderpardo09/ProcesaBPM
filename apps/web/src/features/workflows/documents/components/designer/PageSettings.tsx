import type { PdfDesign } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Select } from '@/shared/ui';
import { WholeNumberField } from '../../../builder/components/WholeNumberField';
import styles from './Designer.module.css';

const SIZES = ['A4', 'LETTER', 'LEGAL'] as const;
const ORIENTATIONS = ['PORTRAIT', 'LANDSCAPE'] as const;
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Paper, orientation, margins (points: 72 per inch) and the text size blocks use unless they say otherwise. */
export function PageSettings({ design, onChange }: { readonly design: PdfDesign; readonly onChange: (design: PdfDesign) => void }) {
  const { t } = useTranslation('workflows');
  const page = design.page;
  return (
    <details className={styles.band}>
      <summary className={styles.bandTitle}>{t('documents.designer.page.title')}</summary>
      <div className={styles.blockForm}>
        <div className={styles.pair}>
          <Select label={t('documents.designer.page.size')} options={SIZES.map((size) => ({ value: size, label: t(`documents.designer.page.sizes.${size}`) }))} value={page.size} onChange={(event) => onChange({ ...design, page: { ...page, size: event.target.value as PdfDesign['page']['size'] } })} />
          <Select
            label={t('documents.designer.page.orientation')}
            options={ORIENTATIONS.map((orientation) => ({ value: orientation, label: t(`documents.designer.page.orientations.${orientation}`) }))}
            value={page.orientation}
            onChange={(event) => onChange({ ...design, page: { ...page, orientation: event.target.value as PdfDesign['page']['orientation'] } })}
          />
        </div>
        <fieldset className={styles.checks}>
          <legend>{t('documents.designer.page.margins')}</legend>
          <p className={styles.note}>{t('documents.designer.page.marginsHint')}</p>
          <div className={styles.quad}>
            {SIDES.map((side) => (
              <WholeNumberField key={side} label={t(`documents.designer.page.sides.${side}`)} value={page.margins[side]} onChange={(value) => onChange({ ...design, page: { ...page, margins: { ...page.margins, [side]: value ?? 0 } } })} />
            ))}
          </div>
        </fieldset>
        <WholeNumberField label={t('documents.designer.page.fontSize')} hint={t('documents.designer.block.points', { min: 6, max: 24 })} value={design.defaults.fontSize} onChange={(fontSize) => onChange({ ...design, defaults: { fontSize: fontSize ?? 0 } })} />
      </div>
    </details>
  );
}

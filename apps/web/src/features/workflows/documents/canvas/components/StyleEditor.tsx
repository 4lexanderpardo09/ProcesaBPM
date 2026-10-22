import { CANVAS_ALIGNS, CANVAS_FONTS, CANVAS_VERTICAL_ALIGNS, type CanvasStyle } from '@procesabpm/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, Select } from '@/shared/ui';
import { DecimalField } from '../../../builder/components/DecimalField';
import styles from './Canvas.module.css';

/** A colour picker with its label. */
export function ColorField({ label, value, onChange, disabled = false }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly disabled?: boolean }) {
  const id = useId();
  return (
    <div className={styles.colorField}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="color" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value.toUpperCase())} />
    </div>
  );
}

/** A number within limits; what is out of them or empty is not applied. */
function Measure({ label, value, min, max, onChange }: { readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly onChange: (value: number) => void }) {
  return (
    <DecimalField
      label={label}
      value={value}
      onChange={(next) => {
        if (next !== null && next >= min && next <= max) onChange(next);
      }}
    />
  );
}

export interface StyleEditorProps {
  readonly style: CanvasStyle;
  readonly onChange: (style: CanvasStyle) => void;
  /** Lines and images have no text: only the box settings show. */
  readonly text?: boolean;
}

/** Letters, alignment and the box (background, border, corners, inner space) of an element. */
export function StyleEditor({ style, onChange, text = true }: StyleEditorProps) {
  const { t } = useTranslation('workflows');
  const set = (changes: Partial<CanvasStyle>) => onChange({ ...style, ...changes });
  return (
    <div className={styles.form}>
      {text && (
        <>
          <div className={styles.row2}>
            <Select label={t('documents.canvas.style.font')} options={CANVAS_FONTS.map((font) => ({ value: font, label: t(`documents.canvas.style.fonts.${font}`) }))} value={style.font} onChange={(event) => set({ font: event.target.value as CanvasStyle['font'] })} />
            <Measure label={t('documents.canvas.style.size')} value={style.size} min={5} max={72} onChange={(size) => set({ size })} />
          </div>
          <div className={styles.row2}>
            <Checkbox label={t('documents.canvas.style.bold')} checked={style.bold} onChange={(event) => set({ bold: event.target.checked })} />
            <Checkbox label={t('documents.canvas.style.italic')} checked={style.italic} onChange={(event) => set({ italic: event.target.checked })} />
            <Checkbox label={t('documents.canvas.style.underline')} checked={style.underline} onChange={(event) => set({ underline: event.target.checked })} />
          </div>
          <div className={styles.row2}>
            <Select label={t('documents.canvas.style.align')} options={CANVAS_ALIGNS.map((align) => ({ value: align, label: t(`documents.canvas.style.aligns.${align}`) }))} value={style.align} onChange={(event) => set({ align: event.target.value as CanvasStyle['align'] })} />
            <Select
              label={t('documents.canvas.style.verticalAlign')}
              options={CANVAS_VERTICAL_ALIGNS.map((align) => ({ value: align, label: t(`documents.canvas.style.verticalAligns.${align}`) }))}
              value={style.verticalAlign}
              onChange={(event) => set({ verticalAlign: event.target.value as CanvasStyle['verticalAlign'] })}
            />
          </div>
          <div className={styles.row2}>
            <ColorField label={t('documents.canvas.style.color')} value={style.color} onChange={(color) => set({ color })} />
            <Measure label={t('documents.canvas.style.lineHeight')} value={style.lineHeight} min={1} max={3} onChange={(lineHeight) => set({ lineHeight })} />
          </div>
        </>
      )}
      <div className={styles.row2}>
        <Checkbox label={t('documents.canvas.style.hasBackground')} checked={style.background !== null} onChange={(event) => set({ background: event.target.checked ? '#F3F4F6' : null })} />
        {style.background !== null && <ColorField label={t('documents.canvas.style.background')} value={style.background} onChange={(background) => set({ background })} />}
      </div>
      <div className={styles.row2}>
        <Measure label={t('documents.canvas.style.border')} value={style.border} min={0} max={10} onChange={(border) => set({ border })} />
        <ColorField label={t('documents.canvas.style.borderColor')} value={style.borderColor} onChange={(borderColor) => set({ borderColor })} />
      </div>
      <div className={styles.row2}>
        <Measure label={t('documents.canvas.style.radius')} value={style.radius} min={0} max={50} onChange={(radius) => set({ radius })} />
        <Measure label={t('documents.canvas.style.padding')} value={style.padding} min={0} max={30} onChange={(padding) => set({ padding })} />
      </div>
    </div>
  );
}

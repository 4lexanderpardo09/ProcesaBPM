import { type CanvasCalculation, FIELD_CODE_PATTERN, type PdfCanvasDesign } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Button, PlusIcon, Select, TextField } from '@/shared/ui';
import { DecimalField } from '../../../builder/components/DecimalField';
import { WholeNumberField } from '../../../builder/components/WholeNumberField';
import { removeSheet, swapSheets } from '../lib/canvas-doc';
import styles from './Canvas.module.css';

const MAX_CALCULATIONS = 50;

export interface PagePropertiesProps {
  readonly design: PdfCanvasDesign;
  readonly sheet: number;
  readonly problems: readonly string[];
  readonly disabled: boolean;
  readonly onChange: (design: PdfCanvasDesign, key?: string) => void;
  readonly onSheet: (sheet: number) => void;
}

/** With nothing selected: the paper, the sheet being edited and the calculations of the format. */
export function PageProperties({ design, sheet, problems, disabled, onChange, onSheet }: PagePropertiesProps) {
  const { t } = useTranslation('workflows');
  const page = design.page;
  const current = design.sheets[sheet] ?? design.sheets[0]!;
  const setSheet = (changes: Partial<typeof current>, key?: string) => onChange({ ...design, sheets: design.sheets.map((entry, index) => (index === sheet ? { ...entry, ...changes } : entry)) }, key);
  const setCalculation = (index: number, changes: Partial<CanvasCalculation>, key?: string) => onChange({ ...design, calculations: design.calculations.map((entry, position) => (position === index ? { ...entry, ...changes } : entry)) }, key);
  const nextCode = () => {
    let number = design.calculations.length + 1;
    while (design.calculations.some((entry) => entry.code === `CALC_${number}`)) number += 1;
    return `CALC_${number}`;
  };

  return (
    <fieldset className={`${styles.form} ${styles.panel}`} disabled={disabled}>
      {problems.length > 0 && (
        <ul className={styles.problems}>
          {problems.map((problem, index) => (
            <li key={index}>{problem}</li>
          ))}
        </ul>
      )}
      <h2 className={styles.panelTitle}>{t('documents.canvas.page.title')}</h2>
      <div className={styles.row2}>
        <Select label={t('documents.designer.page.size')} options={(['LETTER', 'A4', 'LEGAL'] as const).map((size) => ({ value: size, label: t(`documents.designer.page.sizes.${size}`) }))} value={page.size} onChange={(event) => onChange({ ...design, page: { ...page, size: event.target.value as typeof page.size } })} />
        <Select
          label={t('documents.designer.page.orientation')}
          options={(['PORTRAIT', 'LANDSCAPE'] as const).map((orientation) => ({ value: orientation, label: t(`documents.designer.page.orientations.${orientation}`) }))}
          value={page.orientation}
          onChange={(event) => onChange({ ...design, page: { ...page, orientation: event.target.value as typeof page.orientation } })}
        />
      </div>
      <DecimalField
        label={t('documents.canvas.page.marginBottom')}
        hint={t('documents.canvas.page.marginBottomHint')}
        value={page.marginBottom}
        onChange={(marginBottom) => {
          if (marginBottom !== null && marginBottom >= 0 && marginBottom <= 100) onChange({ ...design, page: { ...page, marginBottom } }, 'margin');
        }}
      />

      <section className={styles.section} aria-label={t('documents.canvas.page.sheetTitle', { number: sheet + 1 })}>
        <h3 className={styles.sectionTitle}>{current.name || t('documents.canvas.sheetName', { number: sheet + 1 })}</h3>
        <TextField label={t('documents.canvas.page.sheetName')} maxLength={100} value={current.name} onChange={(event) => setSheet({ name: event.target.value }, `sheet-name-${sheet}`)} />
        <TextField label={t('documents.canvas.page.sheetCondition')} hint={t('documents.canvas.page.sheetConditionHint')} value={current.condition} onChange={(event) => setSheet({ condition: event.target.value }, `sheet-condition-${sheet}`)} />
        {design.sheets.length > 1 && (
          <div className={styles.row2}>
            <Button disabled={sheet === 0} onClick={() => (onChange(swapSheets(design, sheet, sheet - 1)), onSheet(sheet - 1))}>
              {t('documents.canvas.page.sheetBefore')}
            </Button>
            <Button disabled={sheet === design.sheets.length - 1} onClick={() => (onChange(swapSheets(design, sheet, sheet + 1)), onSheet(sheet + 1))}>
              {t('documents.canvas.page.sheetAfter')}
            </Button>
            <Button variant="ghost" onClick={() => (onChange(removeSheet(design, sheet)), onSheet(Math.max(0, sheet - 1)))}>
              {t('documents.canvas.page.sheetRemove')}
            </Button>
          </div>
        )}
      </section>

      <section className={styles.section} aria-label={t('documents.canvas.calculations.title')}>
        <h3 className={styles.sectionTitle}>{t('documents.canvas.calculations.title')}</h3>
        <p className={styles.note}>{t('documents.canvas.calculations.hint')}</p>
        {design.calculations.map((calculation, index) => (
          <div key={index} className={styles.columnRow}>
            <div className={styles.row2}>
              <TextField label={t('documents.canvas.calculations.name')} maxLength={100} value={calculation.name} onChange={(event) => setCalculation(index, { name: event.target.value }, `calc-name-${index}`)} />
              <TextField
                label={t('documents.canvas.calculations.code')}
                maxLength={100}
                error={FIELD_CODE_PATTERN.test(calculation.code) ? undefined : t('documents.canvas.calculations.codeInvalid')}
                value={calculation.code}
                onChange={(event) => setCalculation(index, { code: event.target.value.toUpperCase() }, `calc-code-${index}`)}
              />
            </div>
            <TextField label={t('documents.canvas.calculations.formula')} placeholder="SUM(ITEMS.AMOUNT) - CASH" value={calculation.formula} onChange={(event) => setCalculation(index, { formula: event.target.value }, `calc-formula-${index}`)} />
            <div className={styles.row2}>
              <WholeNumberField label={t('documents.canvas.calculations.decimals')} min={0} max={6} value={calculation.decimals} onChange={(decimals) => setCalculation(index, { decimals: Math.max(0, Math.min(6, decimals ?? 0)) })} />
              <Button variant="ghost" aria-label={t('documents.canvas.calculations.removeNamed', { name: calculation.name || calculation.code })} onClick={() => onChange({ ...design, calculations: design.calculations.filter((_, position) => position !== index) })}>
                {t('remove')}
              </Button>
            </div>
          </div>
        ))}
        {design.calculations.length < MAX_CALCULATIONS && (
          <Button icon={<PlusIcon size={14} />} onClick={() => onChange({ ...design, calculations: [...design.calculations, { code: nextCode(), name: '', formula: '0', decimals: 2 }] })}>
            {t('documents.canvas.calculations.add')}
          </Button>
        )}
      </section>
    </fieldset>
  );
}

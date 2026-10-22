import type { CanvasElement, PdfCanvasDesign, WorkflowVersionDocument } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, PlusIcon, Select, TextField } from '@/shared/ui';
import { DecimalField } from '../../../builder/components/DecimalField';
import { WholeNumberField } from '../../../builder/components/WholeNumberField';
import { signingSteps, tableColumnsOf } from '../../lib/data-choices';
import { ExpressionField } from '../../components/designer/ExpressionField';
import { ColorField, StyleEditor } from './StyleEditor';
import styles from './Canvas.module.css';

type Of<T extends CanvasElement['type']> = Extract<CanvasElement, { type: T }>;
type Column = Of<'table'>['columns'][number];

export interface ElementPropertiesProps {
  readonly element: CanvasElement;
  readonly design: PdfCanvasDesign;
  readonly document: WorkflowVersionDocument;
  readonly problems: readonly string[];
  readonly disabled: boolean;
  /** `key` merges quick changes of one property into one undo step. */
  readonly onChange: (element: CanvasElement, key?: string) => void;
  readonly onDuplicate: () => void;
  readonly onRemove: () => void;
}

/** A measure in millimetres: only a number in range is applied. */
function Millimetres({ label, value, min, max, onChange }: { readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly onChange: (value: number) => void }) {
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

/** Everything about the selected element: where it is, what it shows, when it prints and how it looks. */
export function ElementProperties({ element, design, document, problems, disabled, onChange, onDuplicate, onRemove }: ElementPropertiesProps) {
  const { t } = useTranslation('workflows');
  const set = (changes: Partial<CanvasElement>, key?: string) => onChange({ ...element, ...changes } as CanvasElement, key);
  const calculations = design.calculations.map((calculation) => ({ code: calculation.code, name: calculation.name }));
  return (
    <fieldset className={`${styles.form} ${styles.panel}`} disabled={disabled}>
      <h2 className={styles.panelTitle}>{t(`documents.canvas.tools.${element.type}`)}</h2>
      {problems.length > 0 && (
        <ul className={styles.problems}>
          {problems.map((problem, index) => (
            <li key={index}>{problem}</li>
          ))}
        </ul>
      )}
      <TextField label={t('documents.canvas.props.name')} maxLength={100} value={element.name} onChange={(event) => set({ name: event.target.value }, `name-${element.id}`)} />

      {element.type === 'text' && (
        <>
          <ExpressionField label={t('documents.canvas.props.content')} multiline value={element.content} document={document} inBand calculations={calculations} onChange={(content) => set({ content }, `content-${element.id}`)} />
          <Checkbox label={t('documents.canvas.props.grow')} checked={element.grow} onChange={(event) => set({ grow: event.target.checked })} />
        </>
      )}
      {element.type === 'table' && <TableProperties element={element} document={document} calculations={calculations} onChange={(next, key) => onChange(next, key)} />}
      {element.type === 'image' && (
        <Select
          label={t('documents.canvas.props.fit')}
          options={(['CONTAIN', 'COVER', 'STRETCH'] as const).map((fit) => ({ value: fit, label: t(`documents.canvas.props.fits.${fit}`) }))}
          value={element.fit}
          onChange={(event) => set({ fit: event.target.value as Of<'image'>['fit'] })}
        />
      )}
      {element.type === 'line' && (
        <>
          <div className={styles.row2}>
            <Select
              label={t('documents.canvas.props.orientation')}
              options={(['HORIZONTAL', 'VERTICAL'] as const).map((value) => ({ value, label: t(`documents.canvas.props.orientations.${value}`) }))}
              value={element.orientation}
              onChange={(event) => set({ orientation: event.target.value as Of<'line'>['orientation'] })}
            />
            <Select label={t('documents.canvas.props.dash')} options={(['SOLID', 'DASHED', 'DOTTED'] as const).map((value) => ({ value, label: t(`documents.canvas.props.dashes.${value}`) }))} value={element.dash} onChange={(event) => set({ dash: event.target.value as Of<'line'>['dash'] })} />
          </div>
          <div className={styles.row2}>
            <Millimetres label={t('documents.canvas.props.thickness')} value={element.thickness} min={0.1} max={10} onChange={(thickness) => set({ thickness })} />
            <ColorField label={t('documents.canvas.style.color')} value={element.color} onChange={(color) => set({ color }, `color-${element.id}`)} />
          </div>
        </>
      )}
      {element.type === 'signature' && <SignatureProperties element={element} document={document} onChange={(next, key) => onChange(next, key)} />}

      <section className={styles.section} aria-label={t('documents.canvas.props.placement')}>
        <h3 className={styles.sectionTitle}>{t('documents.canvas.props.placement')}</h3>
        <div className={styles.row4}>
          <Millimetres label={t('documents.canvas.props.x')} value={element.x} min={-400} max={400} onChange={(x) => set({ x })} />
          <Millimetres label={t('documents.canvas.props.y')} value={element.y} min={-400} max={400} onChange={(y) => set({ y })} />
          <Millimetres label={t('documents.canvas.props.width')} value={element.width} min={1} max={400} onChange={(width) => set({ width })} />
          <Millimetres label={t('documents.canvas.props.height')} value={element.height} min={0.5} max={400} onChange={(height) => set({ height })} />
        </div>
        <Checkbox label={t('documents.canvas.props.repeat')} checked={element.repeat} onChange={(event) => set({ repeat: event.target.checked })} />
        <Checkbox label={t('documents.canvas.props.locked')} checked={element.locked} onChange={(event) => set({ locked: event.target.checked })} />
        {design.sheets.length > 1 && !element.repeat && (
          <Select
            label={t('documents.canvas.props.sheet')}
            options={design.sheets.map((sheet, index) => ({ value: String(index), label: sheet.name || t('documents.canvas.sheetName', { number: index + 1 }) }))}
            value={String(element.sheet)}
            onChange={(event) => set({ sheet: Number(event.target.value) })}
          />
        )}
        <TextField label={t('documents.canvas.props.condition')} hint={t('documents.canvas.props.conditionHint')} value={element.condition} onChange={(event) => set({ condition: event.target.value }, `condition-${element.id}`)} />
      </section>

      <section className={styles.section} aria-label={t('documents.canvas.props.style')}>
        <h3 className={styles.sectionTitle}>{element.type === 'table' ? t('documents.canvas.props.bodyStyle') : t('documents.canvas.props.style')}</h3>
        <StyleEditor style={element.style} text={element.type !== 'line' && element.type !== 'image' && element.type !== 'rectangle'} onChange={(style) => set({ style }, `style-${element.id}`)} />
      </section>
      {element.type === 'table' && (
        <section className={styles.section} aria-label={t('documents.canvas.props.headerStyle')}>
          <h3 className={styles.sectionTitle}>{t('documents.canvas.props.headerStyle')}</h3>
          <StyleEditor style={element.headerStyle} onChange={(headerStyle) => set({ headerStyle }, `header-${element.id}`)} />
        </section>
      )}

      <div className={styles.section}>
        <div className={styles.row2}>
          <Button onClick={onDuplicate}>{t('documents.canvas.duplicate')}</Button>
          <Button variant="ghost" onClick={onRemove}>
            {t('remove')}
          </Button>
        </div>
      </div>
    </fieldset>
  );
}

function TableProperties({ element, document, calculations, onChange }: { readonly element: Of<'table'>; readonly document: WorkflowVersionDocument; readonly calculations: ReadonlyArray<{ code: string; name: string }>; readonly onChange: (element: CanvasElement, key?: string) => void }) {
  const { t } = useTranslation('workflows');
  const tables = document.fields.filter((field) => field.type === 'TABLE');
  const field = tables.find((candidate) => candidate.code === element.fieldCode);
  const set = (changes: Partial<Of<'table'>>, key?: string) => onChange({ ...element, ...changes }, key);
  const setColumn = (index: number, changes: Partial<Column>, key?: string) => set({ columns: element.columns.map((column, position) => (position === index ? { ...column, ...changes } : column)) }, key);
  const move = (index: number, to: number) => {
    const columns = [...element.columns];
    const [column] = columns.splice(index, 1);
    columns.splice(to, 0, column!);
    set({ columns });
  };
  return (
    <>
      <Select
        label={t('documents.canvas.props.tableField')}
        placeholder={t('documents.canvas.props.chooseTable')}
        options={tables.map((candidate) => ({ value: candidate.code, label: candidate.label }))}
        value={element.fieldCode}
        onChange={(event) => {
          const chosen = tables.find((candidate) => candidate.code === event.target.value);
          if (chosen === undefined) return;
          const columns = tableColumnsOf(chosen);
          set({ fieldCode: chosen.code, columns: columns.length === 0 ? element.columns : columns.map((column) => ({ header: column.label, value: `{{row.${column.code}}}`, align: 'LEFT', weight: 1, sum: false })) });
        }}
      />
      <section className={styles.section} aria-label={t('documents.canvas.props.columns')}>
        <h3 className={styles.sectionTitle}>{t('documents.canvas.props.columns')}</h3>
        {element.columns.map((column, index) => (
          <div key={index} className={styles.columnRow}>
            <div className={styles.columnHead}>
              <strong>{column.header || t('documents.canvas.props.columnNumber', { number: index + 1 })}</strong>
              <span>
                <button type="button" className={styles.iconButton} disabled={index === 0} aria-label={t('documents.canvas.props.columnLeft', { number: index + 1 })} onClick={() => move(index, index - 1)}>
                  ←
                </button>
                <button type="button" className={styles.iconButton} disabled={index === element.columns.length - 1} aria-label={t('documents.canvas.props.columnRight', { number: index + 1 })} onClick={() => move(index, index + 1)}>
                  →
                </button>
                <button type="button" className={styles.iconButton} disabled={element.columns.length === 1} aria-label={t('documents.canvas.props.columnRemove', { number: index + 1 })} onClick={() => set({ columns: element.columns.filter((_, position) => position !== index) })}>
                  ✕
                </button>
              </span>
            </div>
            <TextField label={t('documents.canvas.props.columnHeader')} maxLength={200} value={column.header} onChange={(event) => setColumn(index, { header: event.target.value }, `header-${element.id}-${index}`)} />
            <ExpressionField label={t('documents.canvas.props.columnValue')} value={column.value} document={document} inBand table={field} calculations={calculations} onChange={(value) => setColumn(index, { value }, `value-${element.id}-${index}`)} />
            <div className={styles.row2}>
              <Select label={t('documents.canvas.style.align')} options={(['LEFT', 'CENTER', 'RIGHT'] as const).map((align) => ({ value: align, label: t(`documents.canvas.style.aligns.${align}`) }))} value={column.align} onChange={(event) => setColumn(index, { align: event.target.value as Column['align'] })} />
              <DecimalField
                label={t('documents.canvas.props.columnWeight')}
                value={column.weight}
                onChange={(weight) => {
                  if (weight !== null && weight >= 1 && weight <= 20) setColumn(index, { weight });
                }}
              />
            </div>
            <Checkbox label={t('documents.canvas.props.columnSum')} checked={column.sum} onChange={(event) => setColumn(index, { sum: event.target.checked })} />
          </div>
        ))}
        {element.columns.length < 12 && (
          <Button icon={<PlusIcon size={14} />} onClick={() => set({ columns: [...element.columns, { header: '', value: '', align: 'LEFT', weight: 1, sum: false }] })}>
            {t('documents.canvas.props.addColumn')}
          </Button>
        )}
      </section>
      <Checkbox label={t('documents.canvas.props.showHeader')} checked={element.showHeader} onChange={(event) => set({ showHeader: event.target.checked })} />
      <div className={styles.row2}>
        <Checkbox label={t('documents.canvas.props.zebra')} checked={element.zebra !== null} onChange={(event) => set({ zebra: event.target.checked ? '#F3F4F6' : null })} />
        {element.zebra !== null && <ColorField label={t('documents.canvas.props.zebraColor')} value={element.zebra} onChange={(zebra) => set({ zebra }, `zebra-${element.id}`)} />}
      </div>
      <Checkbox label={t('documents.canvas.props.showTotals')} checked={element.showTotals} onChange={(event) => set({ showTotals: event.target.checked })} />
      {element.showTotals && <TextField label={t('documents.canvas.props.totalLabel')} maxLength={100} value={element.totalLabel} onChange={(event) => set({ totalLabel: event.target.value }, `total-${element.id}`)} />}
      <WholeNumberField label={t('documents.canvas.props.minRows')} hint={t('documents.canvas.props.minRowsHint')} min={0} max={100} value={element.minRows} onChange={(minRows) => set({ minRows: Math.max(0, Math.min(100, minRows ?? 0)) })} />
      <TextField label={t('documents.canvas.props.emptyMessage')} maxLength={200} value={element.emptyMessage} onChange={(event) => set({ emptyMessage: event.target.value }, `empty-${element.id}`)} />
    </>
  );
}

function SignatureProperties({ element, document, onChange }: { readonly element: Of<'signature'>; readonly document: WorkflowVersionDocument; readonly onChange: (element: CanvasElement, key?: string) => void }) {
  const { t } = useTranslation('workflows');
  const set = (changes: Partial<Of<'signature'>>, key?: string) => onChange({ ...element, ...changes }, key);
  const steps = signingSteps(document);
  return (
    <>
      <Select
        label={t('documents.canvas.props.signatureSource')}
        options={(['STEP', 'REQUESTER', 'BLANK'] as const).map((source) => ({ value: source, label: t(`documents.canvas.props.signatureSources.${source}`) }))}
        value={element.source}
        onChange={(event) => {
          const source = event.target.value as Of<'signature'>['source'];
          set({ source, stepName: source === 'STEP' ? (element.stepName ?? steps[0]?.name ?? null) : null });
        }}
      />
      {element.source === 'STEP' && (
        <>
          <Select label={t('documents.canvas.props.signatureStep')} placeholder={t('documents.canvas.props.chooseStep')} options={steps.map((step) => ({ value: step.name, label: step.name }))} value={element.stepName ?? ''} onChange={(event) => set({ stepName: event.target.value === '' ? null : event.target.value })} />
          <div className={styles.row2}>
            <Select
              label={t('documents.canvas.props.signers')}
              options={(['LAST', 'ALL', 'POSITION'] as const).map((value) => ({ value, label: t(`documents.canvas.props.signerModes.${value}`) }))}
              value={element.signers}
              onChange={(event) => set({ signers: event.target.value as Of<'signature'>['signers'] })}
            />
            {element.signers === 'POSITION' && <WholeNumberField label={t('documents.canvas.props.position')} min={1} max={50} value={element.position} onChange={(position) => set({ position: Math.max(1, Math.min(50, position ?? 1)) })} />}
          </div>
        </>
      )}
      <TextField label={t('documents.canvas.props.signatureLabel')} maxLength={100} value={element.label} onChange={(event) => set({ label: event.target.value }, `label-${element.id}`)} />
      <Checkbox label={t('documents.canvas.props.showName')} checked={element.showName} onChange={(event) => set({ showName: event.target.checked })} />
      <Checkbox label={t('documents.canvas.props.showDate')} checked={element.showDate} onChange={(event) => set({ showDate: event.target.checked })} />
      <Checkbox label={t('documents.canvas.props.showLine')} checked={element.showLine} onChange={(event) => set({ showLine: event.target.checked })} />
    </>
  );
}

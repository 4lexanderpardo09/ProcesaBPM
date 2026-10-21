import type { FieldDocument, PdfBlock, TransitionCondition, WorkflowVersionDocument } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, PlusIcon, Select, TextField } from '@/shared/ui';
import { ConditionEditor } from '../../../builder/components/ConditionEditor';
import { DecimalField } from '../../../builder/components/DecimalField';
import { WholeNumberField } from '../../../builder/components/WholeNumberField';
import { signingSteps, tableColumnsOf } from '../../lib/data-choices';
import { ExpressionField } from './ExpressionField';
import styles from './Designer.module.css';

type Block<T extends PdfBlock['type']> = Extract<PdfBlock, { type: T }>;
type Align = 'LEFT' | 'CENTER' | 'RIGHT';
const ALIGNS: readonly Align[] = ['LEFT', 'CENTER', 'RIGHT'];
const SIGNER_TYPES = ['STEP_ASSIGNEE', 'APPROVER', 'CREATOR', 'USER', 'POSITION'] as const;

/** Sets a key, or takes it out when the value is empty (the format never stores `undefined`). */
function patch<T extends object>(target: T, changes: Readonly<Record<string, unknown>>): T {
  const next = { ...target } as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === null || value === '') delete next[key];
    else next[key] = value;
  }
  return next as T;
}

export interface BlockEditorProps {
  readonly block: PdfBlock;
  readonly document: WorkflowVersionDocument;
  readonly inBand: boolean;
  readonly onChange: (block: PdfBlock) => void;
}

/** The settings of one block, by its type, then what every block has: space around it and when it shows. */
export function BlockEditor({ block, document, inBand, onChange }: BlockEditorProps) {
  const { t } = useTranslation('workflows');
  const set = (changes: Readonly<Record<string, unknown>>) => onChange(patch(block, changes));
  return (
    <div className={styles.blockForm}>
      {block.type === 'heading' && (
        <>
          <ExpressionField label={t('documents.designer.block.text')} value={block.text} onChange={(text) => onChange({ ...block, text })} document={document} inBand={inBand} />
          <Select label={t('documents.designer.block.level')} options={[1, 2, 3].map((level) => ({ value: String(level), label: t('documents.designer.block.levelValue', { level }) }))} value={String(block.level)} onChange={(event) => set({ level: Number(event.target.value) })} />
        </>
      )}
      {block.type === 'text' && <TextBlockEditor block={block} document={document} inBand={inBand} onChange={onChange} />}
      {block.type === 'fields' && <FieldsBlockEditor block={block} document={document} inBand={inBand} onChange={onChange} />}
      {block.type === 'allFields' && <AllFieldsEditor block={block} fields={document.fields} onChange={onChange} />}
      {block.type === 'table' && <TableBlockEditor block={block} document={document} onChange={onChange} />}
      {block.type === 'signatures' && <SignaturesEditor block={block} document={document} onChange={onChange} />}
      {block.type === 'image' && (
        <>
          <p className={styles.note}>{t('documents.designer.block.logoHint')}</p>
          <WholeNumberField label={t('documents.designer.block.width')} hint={t('documents.designer.block.points', { min: 20, max: 300 })} value={block.width} onChange={(width) => set({ width: width ?? 0 })} />
          <AlignSelect value={block.align} onChange={(align) => set({ align })} />
        </>
      )}
      {block.type === 'spacer' && <WholeNumberField label={t('documents.designer.block.height')} hint={t('documents.designer.block.points', { min: 1, max: 200 })} value={block.height} onChange={(height) => set({ height: height ?? 0 })} />}
      {(block.type === 'line' || block.type === 'pageBreak') && <p className={styles.note}>{t(`documents.designer.block.nothing.${block.type}`)}</p>}
      {block.type !== 'pageBreak' && (
        <div className={styles.pair}>
          <WholeNumberField label={t('documents.designer.block.spaceBefore')} value={block.spaceBefore ?? null} onChange={(value) => set({ spaceBefore: value })} />
          <WholeNumberField label={t('documents.designer.block.spaceAfter')} value={block.spaceAfter ?? null} onChange={(value) => set({ spaceAfter: value })} />
        </div>
      )}
      <details className={styles.visibility} open={block.visibleWhen !== undefined}>
        <summary>{t('documents.designer.block.visibleWhen')}</summary>
        <p className={styles.note}>{t('documents.designer.block.visibleWhenHint')}</p>
        <ConditionEditor condition={(block.visibleWhen ?? null) as TransitionCondition | null} fields={document.fields.filter((field) => field.type !== 'TABLE')} readOnly={false} onChange={(rules) => set({ visibleWhen: rules === null || rules.length === 0 ? undefined : rules })} />
      </details>
    </div>
  );
}

function AlignSelect({ value, onChange }: { readonly value: Align | undefined; readonly onChange: (align: Align) => void }) {
  const { t } = useTranslation('workflows');
  return <Select label={t('documents.designer.block.align')} options={ALIGNS.map((align) => ({ value: align, label: t(`documents.designer.aligns.${align}`) }))} value={value ?? 'LEFT'} onChange={(event) => onChange(event.target.value as Align)} />;
}

function TextBlockEditor({ block, document, inBand, onChange }: { readonly block: Block<'text'>; readonly document: WorkflowVersionDocument; readonly inBand: boolean; readonly onChange: (block: PdfBlock) => void }) {
  const { t } = useTranslation('workflows');
  const set = (changes: Readonly<Record<string, unknown>>) => onChange(patch(block, changes));
  return (
    <>
      <ExpressionField label={t('documents.designer.block.text')} value={block.text} onChange={(text) => onChange({ ...block, text })} document={document} inBand={inBand} multiline />
      <div className={styles.pair}>
        <WholeNumberField label={t('documents.designer.block.fontSize')} hint={t('documents.designer.block.points', { min: 6, max: 24 })} value={block.fontSize ?? null} onChange={(fontSize) => set({ fontSize })} />
        <AlignSelect value={block.align} onChange={(align) => set({ align })} />
      </div>
      <Checkbox label={t('documents.designer.block.bold')} checked={block.bold ?? false} onChange={(event) => set({ bold: event.target.checked ? true : undefined })} />
      <TextField label={t('documents.designer.block.color')} hint={t('documents.designer.block.colorHint')} value={block.color ?? ''} maxLength={7} onChange={(event) => set({ color: event.target.value.trim() })} />
    </>
  );
}

function FieldsBlockEditor({ block, document, inBand, onChange }: { readonly block: Block<'fields'>; readonly document: WorkflowVersionDocument; readonly inBand: boolean; readonly onChange: (block: PdfBlock) => void }) {
  const { t } = useTranslation('workflows');
  const items = block.items;
  const setItem = (index: number, item: { label: string; value: string }) => onChange({ ...block, items: items.map((current, at) => (at === index ? item : current)) });
  return (
    <>
      <ol className={styles.items}>
        {items.map((item, index) => (
          <li key={index} className={styles.item}>
            <TextField label={t('documents.designer.block.itemLabel', { index: index + 1 })} value={item.label} maxLength={200} onChange={(event) => setItem(index, { ...item, label: event.target.value })} />
            <ExpressionField label={t('documents.designer.block.itemValue', { index: index + 1 })} value={item.value} onChange={(value) => setItem(index, { ...item, value })} document={document} inBand={inBand} />
            {items.length > 1 && (
              <Button variant="ghost" onClick={() => onChange({ ...block, items: items.filter((_item, at) => at !== index) })}>
                {t('documents.designer.block.removeItem', { index: index + 1 })}
              </Button>
            )}
          </li>
        ))}
      </ol>
      <Button icon={<PlusIcon size={14} />} onClick={() => onChange({ ...block, items: [...items, { label: '', value: '' }] })}>
        {t('documents.designer.block.addItem')}
      </Button>
      <div className={styles.pair}>
        <Select label={t('documents.designer.block.columns')} options={[1, 2, 3].map((columns) => ({ value: String(columns), label: String(columns) }))} value={String(block.columns)} onChange={(event) => onChange({ ...block, columns: Number(event.target.value) as 1 | 2 | 3 })} />
        <WholeNumberField label={t('documents.designer.block.labelWidth')} hint={t('documents.designer.block.percent', { min: 20, max: 60 })} value={block.labelWidthPercent} onChange={(value) => onChange({ ...block, labelWidthPercent: value ?? 0 })} />
      </div>
    </>
  );
}

function AllFieldsEditor({ block, fields, onChange }: { readonly block: Block<'allFields'>; readonly fields: readonly FieldDocument[]; readonly onChange: (block: PdfBlock) => void }) {
  const { t } = useTranslation('workflows');
  const excluded = new Set(block.exclude ?? []);
  const toggle = (code: string, shown: boolean) => {
    const next = shown ? [...excluded].filter((candidate) => candidate !== code) : [...excluded, code];
    onChange(patch(block, { exclude: next.length === 0 ? undefined : next }));
  };
  if (fields.length === 0) return <p className={styles.note}>{t('documents.designer.block.noFields')}</p>;
  return (
    <fieldset className={styles.checks}>
      <legend>{t('documents.designer.block.shownFields')}</legend>
      {fields.map((field) => (
        <Checkbox key={field.code} label={field.label} checked={!excluded.has(field.code)} onChange={(event) => toggle(field.code, event.target.checked)} />
      ))}
    </fieldset>
  );
}

function TableBlockEditor({ block, document, onChange }: { readonly block: Block<'table'>; readonly document: WorkflowVersionDocument; readonly onChange: (block: PdfBlock) => void }) {
  const { t } = useTranslation('workflows');
  const tables = document.fields.filter((field) => field.type === 'TABLE');
  const table = tables.find((field) => field.code === block.fieldCode);
  const columns = block.columns;
  const totals = new Set((block.totals ?? []).map((total) => total.column));
  const setColumn = (index: number, column: Block<'table'>['columns'][number]) => onChange({ ...block, columns: columns.map((current, at) => (at === index ? column : current)) });
  const removeColumn = (index: number) => {
    const shifted = [...totals].filter((column) => column !== index).map((column) => (column > index ? column - 1 : column));
    onChange(patch({ ...block, columns: columns.filter((_column, at) => at !== index) }, { totals: shifted.length === 0 ? undefined : shifted.map((column) => ({ column })) }));
  };
  const toggleTotal = (index: number, on: boolean) => {
    const next = on ? [...totals, index] : [...totals].filter((column) => column !== index);
    onChange(patch(block, { totals: next.length === 0 ? undefined : next.sort((a, b) => a - b).map((column) => ({ column })) }));
  };
  if (tables.length === 0) return <p className={styles.note}>{t('documents.designer.block.noTables')}</p>;
  return (
    <>
      <Select
        label={t('documents.designer.block.tableField')}
        placeholder={t('documents.designer.block.tableFieldPlaceholder')}
        options={tables.map((field) => ({ value: field.code, label: field.label }))}
        value={block.fieldCode}
        onChange={(event) => {
          const chosen = tables.find((field) => field.code === event.target.value);
          // Starting from the table's own columns saves typing each one.
          const fresh = chosen === undefined ? columns : tableColumnsOf(chosen).map((column) => ({ header: column.label, value: `{{row.${column.code}}}`, width: { fr: 1 } }));
          onChange(patch({ ...block, fieldCode: event.target.value, columns: fresh.length === 0 ? columns : fresh }, { totals: undefined }));
        }}
      />
      <ol className={styles.items}>
        {columns.map((column, index) => (
          <li key={index} className={styles.item}>
            <TextField label={t('documents.designer.block.columnHeader', { index: index + 1 })} value={column.header} maxLength={200} onChange={(event) => setColumn(index, { ...column, header: event.target.value })} />
            <ExpressionField label={t('documents.designer.block.columnValue', { index: index + 1 })} value={column.value} onChange={(value) => setColumn(index, { ...column, value })} document={document} inBand={false} table={table} />
            <div className={styles.pair}>
              <DecimalField label={t('documents.designer.block.columnWidth', { index: index + 1 })} hint={t('documents.designer.block.widthHint')} value={'fr' in column.width ? column.width.fr : null} onChange={(fr) => setColumn(index, { ...column, width: { fr: fr ?? 0 } })} />
              <Checkbox label={t('documents.designer.block.total', { index: index + 1 })} checked={totals.has(index)} onChange={(event) => toggleTotal(index, event.target.checked)} />
            </div>
            {columns.length > 1 && (
              <Button variant="ghost" onClick={() => removeColumn(index)}>
                {t('documents.designer.block.removeColumn', { index: index + 1 })}
              </Button>
            )}
          </li>
        ))}
      </ol>
      <Button icon={<PlusIcon size={14} />} onClick={() => onChange({ ...block, columns: [...columns, { header: '', value: '', width: { fr: 1 } }] })}>
        {t('documents.designer.block.addColumn')}
      </Button>
      <Checkbox label={t('documents.designer.block.repeatHeader')} checked={block.repeatHeader} onChange={(event) => onChange({ ...block, repeatHeader: event.target.checked })} />
    </>
  );
}

function SignaturesEditor({ block, document, onChange }: { readonly block: Block<'signatures'>; readonly document: WorkflowVersionDocument; readonly onChange: (block: PdfBlock) => void }) {
  const { t } = useTranslation('workflows');
  const steps = signingSteps(document);
  const slots = block.slots;
  const setSlot = (index: number, slot: Block<'signatures'>['slots'][number]) => onChange({ ...block, slots: slots.map((current, at) => (at === index ? slot : current)) });
  if (steps.length === 0) return <p className={styles.note}>{t('documents.designer.block.noSigningSteps')}</p>;
  return (
    <>
      <ol className={styles.items}>
        {slots.map((slot, index) => (
          <li key={index} className={styles.item}>
            <Select
              label={t('documents.designer.block.slotStep', { index: index + 1 })}
              placeholder={t('documents.designer.block.slotStepPlaceholder')}
              options={steps.map((step) => ({ value: step.name, label: step.name }))}
              value={slot.stepName}
              onChange={(event) => setSlot(index, { ...slot, stepName: event.target.value })}
            />
            <Select
              label={t('documents.designer.block.signerType', { index: index + 1 })}
              options={SIGNER_TYPES.map((type) => ({ value: type, label: t(`documents.designer.signerTypes.${type}`) }))}
              value={slot.signerType}
              onChange={(event) => setSlot(index, { ...slot, signerType: event.target.value as (typeof SIGNER_TYPES)[number] })}
            />
            <TextField label={t('documents.designer.block.signerLabel', { index: index + 1 })} hint={t('documents.designer.block.signerLabelHint')} value={slot.signerLabel ?? ''} maxLength={100} onChange={(event) => setSlot(index, patch(slot, { signerLabel: event.target.value }))} />
            <ExpressionField label={t('documents.designer.block.caption', { index: index + 1 })} value={slot.caption ?? ''} onChange={(caption) => setSlot(index, patch(slot, { caption }))} document={document} inBand={false} />
            {slots.length > 1 && (
              <Button variant="ghost" onClick={() => onChange({ ...block, slots: slots.filter((_slot, at) => at !== index) })}>
                {t('documents.designer.block.removeSlot', { index: index + 1 })}
              </Button>
            )}
          </li>
        ))}
      </ol>
      {slots.length < 12 && (
        <Button icon={<PlusIcon size={14} />} onClick={() => onChange({ ...block, slots: [...slots, { stepName: '', signerType: 'STEP_ASSIGNEE' }] })}>
          {t('documents.designer.block.addSlot')}
        </Button>
      )}
      <div className={styles.pair}>
        <Select label={t('documents.designer.block.perRow')} options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: String(count) }))} value={String(block.perRow)} onChange={(event) => onChange({ ...block, perRow: Number(event.target.value) })} />
        <WholeNumberField label={t('documents.designer.block.boxHeight')} hint={t('documents.designer.block.points', { min: 40, max: 150 })} value={block.height} onChange={(height) => onChange({ ...block, height: height ?? 0 })} />
      </div>
    </>
  );
}

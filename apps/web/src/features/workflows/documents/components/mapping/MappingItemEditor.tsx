import type { MappedField, MappedSignature, WorkflowVersionDocument } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Button, Select, TextField } from '@/shared/ui';
import { DecimalField } from '../../../builder/components/DecimalField';
import { WholeNumberField } from '../../../builder/components/WholeNumberField';
import { signingSteps } from '../../lib/data-choices';
import { type FormField, formFieldsFor, withMode } from '../../lib/mapping-doc';
import { ExpressionField } from '../designer/ExpressionField';
import styles from './Mapping.module.css';

type Mode = 'COORDINATES' | 'ACROFORM';
type Align = 'LEFT' | 'CENTER' | 'RIGHT';
const SIGNER_TYPES = ['STEP_ASSIGNEE', 'APPROVER', 'CREATOR', 'USER', 'POSITION'] as const;

interface PlacementProps {
  readonly mode: Mode;
  readonly formFields: readonly FormField[];
  readonly acroformName: string | undefined;
  readonly placing: boolean;
  readonly onMode: (mode: Mode) => void;
  readonly onFormField: (name: string) => void;
  readonly onPlace: () => void;
}

/** By position on a page (placed with a click or typed) or into a form field the PDF already has. */
function Placement({ mode, formFields, acroformName, placing, onMode, onFormField, onPlace }: PlacementProps) {
  const { t } = useTranslation('workflows');
  return (
    <>
      {formFields.length > 0 && (
        <Select label={t('documents.mapping.mode')} options={(['COORDINATES', 'ACROFORM'] as const).map((value) => ({ value, label: t(`documents.mapping.modes.${value}`) }))} value={mode} onChange={(event) => onMode(event.target.value as Mode)} />
      )}
      {mode === 'ACROFORM' ? (
        <Select
          label={t('documents.mapping.formField')}
          placeholder={t('documents.mapping.formFieldPlaceholder')}
          options={formFields.map((field) => ({ value: field.name, label: field.page === null ? field.name : t('documents.mapping.formFieldOnPage', { name: field.name, page: field.page }) }))}
          value={acroformName ?? ''}
          onChange={(event) => onFormField(event.target.value)}
        />
      ) : (
        <Button variant={placing ? 'brand' : 'secondary'} aria-pressed={placing} onClick={onPlace}>
          {placing ? t('documents.mapping.placing') : t('documents.mapping.place')}
        </Button>
      )}
    </>
  );
}

export interface FieldEditorProps {
  readonly field: MappedField;
  readonly document: WorkflowVersionDocument;
  readonly acroformFields: readonly FormField[];
  readonly placing: boolean;
  readonly onPlace: () => void;
  readonly onChange: (field: MappedField) => void;
}

/** A value: a field of the ticket or a text with data, and where it goes. */
export function MappedFieldEditor({ field, document, acroformFields, placing, onPlace, onChange }: FieldEditorProps) {
  const { t } = useTranslation('workflows');
  const fromText = field.expression !== undefined;
  const setNumber = (key: 'page' | 'x' | 'y' | 'fontSize' | 'maxWidth', value: number | null) => {
    const next: Record<string, unknown> = { ...field };
    if (value === null) delete next[key];
    else next[key] = value;
    onChange(next as MappedField);
  };
  return (
    <div className={styles.form}>
      <Select
        label={t('documents.mapping.source')}
        options={(['field', 'text'] as const).map((value) => ({ value, label: t(`documents.mapping.sources.${value}`) }))}
        value={fromText ? 'text' : 'field'}
        onChange={(event) => {
          const { fieldCode: _code, expression: _expression, ...rest } = field;
          onChange((event.target.value === 'text' ? { ...rest, expression: '' } : { ...rest, fieldCode: '' }) as MappedField);
        }}
      />
      {fromText ? (
        <ExpressionField label={t('documents.mapping.text')} value={field.expression ?? ''} onChange={(expression) => onChange({ ...field, expression })} document={document} inBand={false} />
      ) : (
        <Select
          label={t('documents.mapping.field')}
          placeholder={t('documents.mapping.fieldPlaceholder')}
          options={document.fields.filter((candidate) => candidate.type !== 'TABLE').map((candidate) => ({ value: candidate.code, label: candidate.label }))}
          value={field.fieldCode ?? ''}
          onChange={(event) => onChange({ ...field, fieldCode: event.target.value })}
        />
      )}
      <Placement
        mode={field.mode}
        formFields={formFieldsFor(acroformFields, 'fields')}
        acroformName={field.acroformName}
        placing={placing}
        onMode={(mode) => onChange(withMode(field, mode, false))}
        onFormField={(acroformName) => onChange({ ...field, acroformName })}
        onPlace={onPlace}
      />
      {field.mode === 'COORDINATES' && (
        <>
          <div className={styles.trio}>
            <WholeNumberField label={t('documents.mapping.pageNumber')} min={1} value={field.page ?? null} onChange={(value) => setNumber('page', value)} />
            <DecimalField label={t('documents.mapping.x')} value={field.x ?? null} onChange={(value) => setNumber('x', value)} />
            <DecimalField label={t('documents.mapping.y')} value={field.y ?? null} onChange={(value) => setNumber('y', value)} />
          </div>
          <p className={styles.note}>{t('documents.mapping.coordinatesHint')}</p>
          <div className={styles.trio}>
            <WholeNumberField label={t('documents.designer.block.fontSize')} value={field.fontSize ?? null} onChange={(value) => setNumber('fontSize', value)} />
            <DecimalField label={t('documents.mapping.maxWidth')} hint={t('documents.mapping.maxWidthHint')} value={field.maxWidth ?? null} onChange={(value) => setNumber('maxWidth', value)} />
            <Select
              label={t('documents.designer.block.align')}
              options={(['LEFT', 'CENTER', 'RIGHT'] as const).map((align) => ({ value: align, label: t(`documents.designer.aligns.${align}`) }))}
              value={field.align ?? 'LEFT'}
              onChange={(event) => onChange({ ...field, align: event.target.value as Align })}
            />
          </div>
        </>
      )}
    </div>
  );
}

export interface SignatureEditorProps {
  readonly slot: MappedSignature;
  readonly document: WorkflowVersionDocument;
  readonly acroformFields: readonly FormField[];
  readonly placing: boolean;
  readonly onPlace: () => void;
  readonly onChange: (slot: MappedSignature) => void;
}

/** A signature: whose (the step and who signs there) and the box where its image goes. */
export function MappedSignatureEditor({ slot, document, acroformFields, placing, onPlace, onChange }: SignatureEditorProps) {
  const { t } = useTranslation('workflows');
  const steps = signingSteps(document);
  const setNumber = (key: 'page' | 'x' | 'y' | 'width' | 'height', value: number | null) => {
    const next: Record<string, unknown> = { ...slot };
    if (value === null) delete next[key];
    else next[key] = value;
    onChange(next as MappedSignature);
  };
  return (
    <div className={styles.form}>
      <Select label={t('documents.mapping.step')} placeholder={t('documents.designer.block.slotStepPlaceholder')} options={steps.map((step) => ({ value: step.name, label: step.name }))} value={slot.stepName} onChange={(event) => onChange({ ...slot, stepName: event.target.value })} />
      <Select label={t('documents.mapping.signer')} options={SIGNER_TYPES.map((type) => ({ value: type, label: t(`documents.designer.signerTypes.${type}`) }))} value={slot.signerType} onChange={(event) => onChange({ ...slot, signerType: event.target.value as (typeof SIGNER_TYPES)[number] })} />
      <TextField
        label={t('documents.mapping.signerLabel')}
        hint={t('documents.designer.block.signerLabelHint')}
        maxLength={100}
        value={slot.signerLabel ?? ''}
        onChange={(event) => {
          const { signerLabel: _label, ...rest } = slot;
          onChange(event.target.value === '' ? rest : { ...rest, signerLabel: event.target.value });
        }}
      />
      <Placement
        mode={slot.mode}
        formFields={formFieldsFor(acroformFields, 'signatures')}
        acroformName={slot.acroformName}
        placing={placing}
        onMode={(mode) => onChange(withMode(slot, mode, true))}
        onFormField={(acroformName) => onChange({ ...slot, acroformName })}
        onPlace={onPlace}
      />
      {slot.mode === 'COORDINATES' && (
        <>
          <div className={styles.trio}>
            <WholeNumberField label={t('documents.mapping.pageNumber')} min={1} value={slot.page ?? null} onChange={(value) => setNumber('page', value)} />
            <DecimalField label={t('documents.mapping.x')} value={slot.x ?? null} onChange={(value) => setNumber('x', value)} />
            <DecimalField label={t('documents.mapping.y')} value={slot.y ?? null} onChange={(value) => setNumber('y', value)} />
          </div>
          <div className={styles.trio}>
            <DecimalField label={t('documents.mapping.width')} value={slot.width ?? null} onChange={(value) => setNumber('width', value)} />
            <DecimalField label={t('documents.mapping.height')} value={slot.height ?? null} onChange={(value) => setNumber('height', value)} />
          </div>
          <p className={styles.note}>{t('documents.mapping.boxHint')}</p>
        </>
      )}
    </div>
  );
}

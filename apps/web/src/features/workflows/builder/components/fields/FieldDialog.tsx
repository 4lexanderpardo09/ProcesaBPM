import { FIELD_TYPES, type FieldDocument, type FieldType } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Checkbox, Dialog, Select, TextField } from '@/shared/ui';
import { WorkflowError } from '../../../components/WorkflowError';
import { codeFromLabel, isFieldCode, upsertField } from '../../lib/content-doc';
import { type FieldConfigProblem, fieldConfigProblems } from '../../lib/field-config-problems';
import type { DraftContent } from '../../hooks/use-draft-content';
import { type FieldConfig, FieldConfigEditor, type FieldDataSource } from './FieldConfigEditor';
import styles from '../Builder.module.css';

export interface FieldDialogProps {
  /** The field to edit; creating one without it. */
  readonly field?: FieldDocument;
  readonly stepId: string;
  readonly isStart: boolean;
  readonly fields: readonly FieldDocument[];
  readonly nextSortOrder: number;
  readonly content: DraftContent;
  readonly onClose: () => void;
}

/** What a new field of each type starts with: what its schema needs and the usual choice. */
function startingConfig(type: FieldType): FieldConfig {
  switch (type) {
    case 'SELECT':
    case 'MULTI_SELECT':
      return { options: [{ value: '', label: '' }] };
    case 'CURRENCY':
      return { currencyCode: 'COP' };
    case 'TABLE':
      return { columns: [{ code: '', label: '', type: 'TEXT' }], minRows: 0, maxRows: 200 };
    case 'FILE':
      return { maxFiles: 1, accept: ['PDF', 'IMAGE', 'OFFICE', 'ZIP'] };
    case 'FORMULA':
      return { expression: '', resultType: 'NUMBER' };
    default:
      return {};
  }
}

/** A field of a block: its name, its code (fixed once created), its type and what that type lets configure. */
export function FieldDialog({ field, stepId, isStart, fields, nextSortOrder, content, onClose }: FieldDialogProps) {
  const { t } = useTranslation('workflows');
  const editing = field !== undefined;
  const taken = new Set(fields.filter((candidate) => candidate.id !== field?.id).map((candidate) => candidate.code));
  const [label, setLabel] = useState(field?.label ?? '');
  const [code, setCode] = useState(field?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(editing);
  const [type, setType] = useState<FieldType>(field?.type ?? 'TEXT');
  const [config, setConfig] = useState<FieldConfig>(field?.config ?? startingConfig('TEXT'));
  const [dataSource, setDataSource] = useState<FieldDataSource>(field?.dataSource ?? null);
  const [isRequired, setRequired] = useState(field?.isRequired ?? false);
  const [isReadOnly, setReadOnly] = useState(field?.isReadOnly ?? false);
  const [isImmutable, setImmutable] = useState(field?.isImmutable ?? false);
  const [submitted, setSubmitted] = useState(false);

  const nameError = submitted && label.trim() === '' ? t('builder.fields.dialog.nameRequired') : undefined;
  const codeError = !submitted || editing ? undefined : !isFieldCode(code) ? t('builder.fields.dialog.codeInvalid') : taken.has(code) ? t('builder.fields.dialog.codeTaken') : undefined;
  const problems: FieldConfigProblem[] = submitted ? fieldConfigProblems(type, config, dataSource) : [];
  const others = fields.filter((candidate) => candidate.id !== field?.id);

  const submit = async () => {
    setSubmitted(true);
    if (label.trim() === '' || (!editing && (!isFieldCode(code) || taken.has(code))) || fieldConfigProblems(type, config, dataSource).length > 0 || content.pending) return;
    const ok =
      field === undefined
        ? await content.run({
            call: (api) => api.createField({ stepId, code, label: label.trim(), type, capture: isStart ? 'CREATION' : 'STEP', isRequired, isReadOnly, isImmutable, sortOrder: nextSortOrder, config, dataSource }),
            apply: upsertField,
          })
        : await content.run({
            call: (api) => api.updateField(field.id, { label: label.trim(), isRequired, isReadOnly, isImmutable, config, dataSource }),
            apply: upsertField,
          });
    if (ok) onClose();
  };

  return (
    <Dialog
      open
      title={editing ? t('builder.fields.dialog.editTitle') : t('builder.fields.dialog.createTitle')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="brand" disabled={content.pending}>
            {content.pending ? t('saving') : editing ? t('builder.fields.dialog.submitEdit') : t('builder.fields.dialog.submitCreate')}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <TextField
          label={t('builder.fields.dialog.name')}
          hint={t('builder.fields.dialog.nameHint')}
          required
          maxLength={200}
          error={nameError}
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
            if (!codeTouched) setCode(codeFromLabel(event.target.value, taken));
          }}
        />
        <TextField
          label={t('builder.fields.dialog.code')}
          hint={t('builder.fields.dialog.codeHint')}
          required
          readOnly={editing}
          maxLength={100}
          error={codeError}
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setCodeTouched(true);
          }}
        />
        <Select
          label={t('builder.fields.dialog.type')}
          {...(editing ? { hint: t('builder.fields.dialog.typeFixed') } : {})}
          disabled={editing}
          options={FIELD_TYPES.map((value) => ({ value, label: t(`builder.fields.types.${value}`) }))}
          value={type}
          onChange={(event) => {
            const next = event.target.value as FieldType;
            setType(next);
            setConfig(startingConfig(next));
            setDataSource(null);
          }}
        />
        <Checkbox label={t('builder.fields.dialog.required')} checked={isRequired} onChange={(event) => setRequired(event.target.checked)} />
        <Checkbox label={t('builder.fields.dialog.readOnly')} checked={isReadOnly} onChange={(event) => setReadOnly(event.target.checked)} />
        <Checkbox label={t('builder.fields.dialog.immutable')} checked={isImmutable} onChange={(event) => setImmutable(event.target.checked)} />
        <FieldConfigEditor
          type={type}
          config={config}
          dataSource={dataSource}
          fields={others}
          onChange={(nextConfig, nextSource) => {
            setConfig(nextConfig);
            setDataSource(nextSource);
          }}
        />
        {problems.length > 0 && (
          <Alert tone="danger">
            {problems.map((problem) => (
              <span key={problem} className={styles.block}>
                {t(`builder.fields.problems.${problem}`)}
              </span>
            ))}
          </Alert>
        )}
        <WorkflowError error={content.error} context="field" />
      </div>
    </Dialog>
  );
}

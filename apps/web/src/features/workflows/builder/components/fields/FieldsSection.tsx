import { type StepDocument, type WorkflowVersionDocument } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Dialog, PlusIcon } from '@/shared/ui';
import { WorkflowError } from '../../../components/WorkflowError';
import { fieldsOf, removeField, upsertField } from '../../lib/content-doc';
import type { DraftContent } from '../../hooks/use-draft-content';
import { Section } from '../StepSections';
import { FieldDialog } from './FieldDialog';
import styles from '../Builder.module.css';

export interface FieldsSectionProps {
  readonly step: StepDocument;
  readonly doc: WorkflowVersionDocument;
  readonly readOnly: boolean;
  readonly content: DraftContent;
}

type Editing = { readonly kind: 'edit'; readonly fieldId: string | null } | { readonly kind: 'remove'; readonly fieldId: string } | null;

/** The fields a block asks for, in their order: add, edit, move up or down, and take out. */
export function FieldsSection({ step, doc, readOnly, content }: FieldsSectionProps) {
  const { t } = useTranslation('workflows');
  const [editing, setEditing] = useState<Editing>(null);
  const fields = fieldsOf(doc, step.id);
  const open = (next: Editing) => {
    content.reset();
    setEditing(next);
  };

  // Moving swaps the order of two neighbours (two edits of the draft).
  const move = async (index: number, offset: -1 | 1) => {
    const current = fields[index];
    const other = fields[index + offset];
    if (current === undefined || other === undefined) return;
    const [first, second] = current.sortOrder === other.sortOrder ? [index + offset, index] : [other.sortOrder, current.sortOrder];
    if (await content.run({ call: (api) => api.updateField(current.id, { sortOrder: first }), apply: upsertField })) {
      await content.run({ call: (api) => api.updateField(other.id, { sortOrder: second }), apply: upsertField });
    }
  };
  const removing = editing?.kind === 'remove' ? fields.find((field) => field.id === editing.fieldId) : undefined;
  const editedField = editing?.kind === 'edit' && editing.fieldId !== null ? fields.find((field) => field.id === editing.fieldId) : undefined;

  return (
    <Section title={t('builder.fields.title')}>
      <p className={styles.note}>{step.type === 'START' ? t('builder.fields.hintStart') : t('builder.fields.hintStep')}</p>
      {editing === null && <WorkflowError error={content.error} context="field" />}
      {fields.length === 0 ? (
        <p className={styles.note}>{t('builder.fields.empty')}</p>
      ) : (
        <ol className={styles.fieldList} aria-label={t('builder.fields.label')}>
          {fields.map((field, index) => (
            <li key={field.id} className={styles.fieldRow}>
              <span className={styles.fieldText}>
                <span className={styles.fieldName}>{field.label}</span>
                <span className={styles.fieldMeta}>
                  {field.code} · {t(`builder.fields.types.${field.type}`)}
                </span>
                {(field.isRequired || field.isReadOnly) && (
                  <span className={styles.fieldBadges}>
                    {field.isRequired && <Badge tone="accent">{t('builder.fields.required')}</Badge>}
                    {field.isReadOnly && <Badge>{t('builder.fields.readOnly')}</Badge>}
                  </span>
                )}
              </span>
              {!readOnly && (
                <span className={styles.fieldActions}>
                  <Button variant="ghost" aria-label={t('builder.fields.upNamed', { name: field.label })} title={t('builder.fields.up')} disabled={index === 0 || content.pending} onClick={() => void move(index, -1)}>
                    ↑
                  </Button>
                  <Button variant="ghost" aria-label={t('builder.fields.downNamed', { name: field.label })} title={t('builder.fields.down')} disabled={index === fields.length - 1 || content.pending} onClick={() => void move(index, 1)}>
                    ↓
                  </Button>
                  <Button variant="ghost" aria-label={t('builder.fields.editNamed', { name: field.label })} onClick={() => open({ kind: 'edit', fieldId: field.id })}>
                    {t('builder.fields.edit')}
                  </Button>
                  <Button variant="ghost" aria-label={t('builder.fields.removeNamed', { name: field.label })} onClick={() => open({ kind: 'remove', fieldId: field.id })}>
                    {t('builder.fields.remove')}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {!readOnly && (
        <div>
          <Button icon={<PlusIcon size={14} />} onClick={() => open({ kind: 'edit', fieldId: null })}>
            {t('builder.fields.add')}
          </Button>
        </div>
      )}
      {editing?.kind === 'edit' && (
        <FieldDialog
          {...(editedField === undefined ? {} : { field: editedField })}
          stepId={step.id}
          isStart={step.type === 'START'}
          fields={doc.fields}
          nextSortOrder={fields.reduce((max, field) => Math.max(max, field.sortOrder + 1), 0)}
          content={content}
          onClose={() => setEditing(null)}
        />
      )}
      {removing !== undefined && (
        <Dialog
          open
          title={t('builder.fields.removeTitle')}
          closeLabel={t('close')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>{t('cancel')}</Button>
              <Button
                variant="brand"
                disabled={content.pending}
                onClick={() =>
                  void content
                    .run({ call: (api) => api.deleteField(removing.id), apply: (current) => removeField(current, removing.id) })
                    .then((ok) => ok && setEditing(null))
                }
              >
                {t('builder.fields.remove')}
              </Button>
            </>
          }
        >
          <div className={styles.dialogBody}>
            <p className={styles.note}>{t('builder.fields.removeBody', { name: removing.label, code: removing.code })}</p>
            <WorkflowError error={content.error} context="field" />
          </div>
        </Dialog>
      )}
    </Section>
  );
}

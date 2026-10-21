import type { FieldDocument, WorkflowVersionDocument } from '@procesabpm/shared';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, TextArea, TextField } from '@/shared/ui';
import { type DataChoice, dataChoices } from '../../lib/data-choices';
import styles from './Designer.module.css';

export interface ExpressionFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly document: WorkflowVersionDocument;
  /** In the header or footer: the page numbers can be inserted there. */
  readonly inBand: boolean;
  /** Inside a table block: the row's columns can be inserted. */
  readonly table?: FieldDocument | undefined;
  readonly multiline?: boolean;
  readonly required?: boolean;
  readonly disabled?: boolean;
}

/** A text with data of the ticket in it: typed by hand, or inserted at the cursor from the list of what exists. */
export function ExpressionField({ label, value, onChange, document, inBand, table, multiline = false, required = false, disabled = false }: ExpressionFieldProps) {
  const { t } = useTranslation('workflows');
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const choices = dataChoices(document, { inBand, table });
  const labelOf = (choice: DataChoice) => {
    const name = 'text' in choice.label ? choice.label.text : t(`documents.designer.data.${choice.label.key}` as 'documents.designer.data.completedBy', { step: choice.label.values?.step ?? '', column: choice.label.values?.column ?? '' });
    return t(`documents.designer.data.groups.${choice.group}`, { name });
  };
  const insert = (placeholder: string) => {
    const element = input.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    onChange(`${value.slice(0, start)}${placeholder}${value.slice(end)}`);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  };
  const common = { label, value, required, disabled, onChange: (event: { target: { value: string } }) => onChange(event.target.value) };
  return (
    <div className={styles.expression}>
      {multiline ? <TextArea ref={input} rows={3} {...common} /> : <TextField ref={input} {...common} />}
      {!disabled && (
        <Select
          className={styles.insert}
          label={t('documents.designer.insert', { field: label })}
          placeholder={t('documents.designer.insertPlaceholder')}
          options={choices.map((choice) => ({ value: choice.placeholder, label: labelOf(choice) }))}
          value=""
          onChange={(event) => {
            if (event.target.value !== '') insert(event.target.value);
          }}
        />
      )}
    </div>
  );
}

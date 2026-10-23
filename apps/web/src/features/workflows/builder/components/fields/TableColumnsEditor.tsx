import { useTranslation } from 'react-i18next';
import { Button, Checkbox, PlusIcon, Select, TextField } from '@/shared/ui';
import { codeFromLabel } from '../../lib/content-doc';
import { ListTextField } from '../ListTextField';
import { WholeNumberField } from '../WholeNumberField';
import styles from '../Builder.module.css';

const COLUMN_TYPES = ['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'SELECT', 'FORMULA', 'FILE'] as const;
const FILE_KINDS = ['PDF', 'IMAGE', 'OFFICE', 'ZIP'] as const;
/** A file cell holds one file unless the column says otherwise. */
const MAX_FILES_PER_CELL = 5;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface TableColumn {
  readonly code: string;
  readonly label: string;
  readonly type: ColumnType;
  readonly required?: boolean;
  readonly showTotal?: boolean;
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  /** FORMULA columns: computed from the other columns of the row. */
  readonly expression?: string;
  /** FILE columns: files per cell (one when absent) and accepted kinds (any when absent). */
  readonly maxFiles?: number;
  readonly accept?: readonly string[];
}

const isNumeric = (type: ColumnType) => type === 'NUMBER' || type === 'CURRENCY' || type === 'FORMULA';

/** The columns of a table field; a column's code follows its name until it is typed by hand. */
export function TableColumnsEditor({ columns, onChange }: { readonly columns: readonly TableColumn[]; readonly onChange: (columns: TableColumn[]) => void }) {
  const { t } = useTranslation('workflows');
  const replace = (index: number, column: TableColumn) => onChange(columns.map((current, at) => (at === index ? column : current)));
  const codesBut = (index: number) => new Set(columns.filter((_column, at) => at !== index).map((column) => column.code));
  return (
    <fieldset className={styles.choices}>
      <legend>{t('builder.fields.config.columns')}</legend>
      <ol className={styles.rules}>
        {columns.map((column, index) => (
          <li key={index} className={styles.ruleCompact}>
            <span className={styles.ruleTitle}>{t('builder.fields.config.columnRow', { index: index + 1 })}</span>
            <div className={styles.pair}>
              <TextField
                label={t('builder.fields.config.columnLabel')}
                maxLength={200}
                value={column.label}
                onChange={(event) => {
                  const followsLabel = column.code === '' || column.code === codeFromLabel(column.label, codesBut(index));
                  replace(index, { ...column, label: event.target.value, code: followsLabel ? codeFromLabel(event.target.value, codesBut(index)) : column.code });
                }}
              />
              <TextField label={t('builder.fields.config.columnCode')} maxLength={100} value={column.code} onChange={(event) => replace(index, { ...column, code: event.target.value.toUpperCase() })} />
            </div>
            <Select
              label={t('builder.fields.config.columnType')}
              options={COLUMN_TYPES.map((type) => ({ value: type, label: t(`builder.fields.config.columnTypes.${type}`) }))}
              value={column.type}
              onChange={(event) => {
                const type = event.target.value as ColumnType;
                // Totals and options only belong to some types (the schema refuses them elsewhere).
                const { showTotal: _showTotal, options: _options, expression: _expression, required: _required, maxFiles: _maxFiles, accept: _accept, ...rest } = column;
                replace(index, {
                  ...rest,
                  type,
                  ...(type !== 'FORMULA' && column.required === true ? { required: true } : {}),
                  ...(isNumeric(type) && column.showTotal === true ? { showTotal: true } : {}),
                  ...(type === 'SELECT' ? { options: column.options ?? [] } : {}),
                  ...(type === 'FORMULA' ? { expression: column.expression ?? '' } : {}),
                });
              }}
            />
            {column.type === 'SELECT' && (
              <ListTextField
                label={t('builder.fields.config.columnOptions')}
                values={(column.options ?? []).map((option) => option.label)}
                onChange={(labels) => replace(index, { ...column, options: labels.map((label) => ({ value: label, label })) })}
              />
            )}
            {column.type === 'FORMULA' ? (
              <TextField
                label={t('builder.fields.config.columnExpression')}
                hint={t('builder.fields.config.columnExpressionHint', { codes: columns.filter((other) => other.type !== 'FORMULA' && other.code !== '').map((other) => other.code).join(', ') || '—' })}
                maxLength={500}
                value={column.expression ?? ''}
                onChange={(event) => replace(index, { ...column, expression: event.target.value })}
              />
            ) : (
              <Checkbox label={t('builder.fields.config.columnRequired')} checked={column.required === true} onChange={(event) => replace(index, { ...column, required: event.target.checked })} />
            )}
            {column.type === 'FILE' && <FileColumnSettings column={column} onChange={(changed) => replace(index, changed)} />}
            {isNumeric(column.type) && <Checkbox label={t('builder.fields.config.columnTotal')} checked={column.showTotal === true} onChange={(event) => replace(index, { ...column, showTotal: event.target.checked })} />}
            <Button variant="ghost" onClick={() => onChange(columns.filter((_column, at) => at !== index))}>
              {t('builder.fields.config.removeColumn', { index: index + 1 })}
            </Button>
          </li>
        ))}
      </ol>
      <Button icon={<PlusIcon size={14} />} onClick={() => onChange([...columns, { code: '', label: '', type: 'TEXT' }])}>
        {t('builder.fields.config.addColumn')}
      </Button>
    </fieldset>
  );
}

/** How many files a cell of a file column holds and of which kinds; all kinds unchecked would accept none, so one stays. */
function FileColumnSettings({ column, onChange }: { readonly column: TableColumn; readonly onChange: (column: TableColumn) => void }) {
  const { t } = useTranslation('workflows');
  const accept = column.accept ?? [...FILE_KINDS];
  const setAccept = (kinds: readonly string[]) => {
    const { accept: _accept, ...rest } = column;
    onChange(kinds.length === FILE_KINDS.length ? rest : { ...rest, accept: kinds });
  };
  return (
    <>
      <WholeNumberField
        label={t('builder.fields.config.columnMaxFiles')}
        min={1}
        max={MAX_FILES_PER_CELL}
        value={column.maxFiles ?? 1}
        onChange={(value) => {
          const { maxFiles: _maxFiles, ...rest } = column;
          onChange(value === null || value <= 1 ? rest : { ...rest, maxFiles: Math.min(value, MAX_FILES_PER_CELL) });
        }}
      />
      <fieldset className={styles.choices}>
        <legend>{t('builder.fields.config.accept')}</legend>
        {FILE_KINDS.map((kind) => (
          <Checkbox
            key={kind}
            label={t(`builder.fields.config.acceptKinds.${kind}`)}
            checked={accept.includes(kind)}
            disabled={accept.length === 1 && accept.includes(kind)}
            onChange={(event) => setAccept(event.target.checked ? [...accept.filter((value) => value !== kind), kind] : accept.filter((value) => value !== kind))}
          />
        ))}
      </fieldset>
    </>
  );
}

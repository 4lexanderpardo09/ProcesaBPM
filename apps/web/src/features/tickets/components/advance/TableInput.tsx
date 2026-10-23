import type { FormFieldResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Button, PlusIcon } from '@/shared/ui';
import { columnsOf, formulaCellsOf, type TableColumn, type TableRow } from '../../lib/step-values';
import styles from './TableInput.module.css';

export interface TableInputProps {
  readonly field: FormFieldResponse;
  readonly rows: readonly TableRow[];
  readonly error: string | undefined;
  readonly onChange: (rows: readonly TableRow[]) => void;
}

/** A TABLE field: one row per entry, a cell per column (a formula column shows what it computes); rows are added and removed here, and the API checks the limits. */
export function TableInput({ field, rows, error, onChange }: TableInputProps) {
  const { t } = useTranslation('tickets');
  const columns = columnsOf(field);
  const maxRows = typeof field.config['maxRows'] === 'number' ? field.config['maxRows'] : 200;
  // The day the formulas see (the API uses the company's): enough for what a row formula can do with a date.
  const today = new Date().toISOString().slice(0, 10);
  const number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 6 });
  const setCell = (index: number, code: string, text: string) => onChange(rows.map((row, current) => (current === index ? { ...row, [code]: text } : row)));
  return (
    <fieldset className={styles.table} aria-invalid={error !== undefined}>
      <legend className="text-label">
        {field.label}
        {field.isRequired && <span aria-hidden="true"> *</span>}
      </legend>
      {rows.length === 0 ? (
        <p className={styles.empty}>{t('advance.table.empty')}</p>
      ) : (
        <div className={styles.scroll}>
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.code} scope="col">
                    {column.label}
                    {column.required === true && <span aria-hidden="true"> *</span>}
                  </th>
                ))}
                <th scope="col" aria-label={t('advance.table.actions')} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const computed = formulaCellsOf(columns, row, today);
                return (
                // Rows have no id of their own: their position is who they are while the form is open.
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.code}>
                      {column.type === 'FORMULA' ? (
                        <output className={styles.computed} aria-label={t('advance.table.cell', { column: column.label, row: index + 1 })}>
                          {computed[column.code] === undefined ? '–' : number.format(Number(computed[column.code]))}
                        </output>
                      ) : (
                        <Cell column={column} label={t('advance.table.cell', { column: column.label, row: index + 1 })} value={row[column.code] ?? ''} onChange={(text) => setCell(index, column.code, text)} />
                      )}
                    </td>
                  ))}
                  <td>
                    <Button variant="ghost" aria-label={t('advance.table.removeRow', { row: index + 1 })} onClick={() => onChange(rows.filter((_, current) => current !== index))}>
                      ×
                    </Button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <Button icon={<PlusIcon />} disabled={rows.length >= maxRows} onClick={() => onChange([...rows, {}])}>
          {t('advance.table.addRow')}
        </Button>
      </div>
      {error !== undefined && <span className={styles.error}>{error}</span>}
    </fieldset>
  );
}

function Cell({ column, label, value, onChange }: { readonly column: TableColumn; readonly label: string; readonly value: string; readonly onChange: (text: string) => void }) {
  const { t } = useTranslation('tickets');
  if (column.type === 'SELECT') {
    return (
      <select className={styles.cell} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('advance.choose')}</option>
        {(column.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  const numeric = column.type === 'NUMBER' || column.type === 'CURRENCY';
  return <input className={styles.cell} aria-label={label} type={column.type === 'DATE' ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined} value={value} onChange={(event) => onChange(event.target.value)} />;
}

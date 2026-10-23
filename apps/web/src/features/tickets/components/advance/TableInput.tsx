import type { FileKind, FormFieldResponse } from '@procesabpm/shared';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, PlusIcon } from '@/shared/ui';
import { cellFiles, cellText, columnsOf, formulaCellsOf, type TableColumn, type TableRow } from '../../lib/step-values';
import { useFilePicking } from './FileInput';
import styles from './TableInput.module.css';

export interface TableInputProps {
  readonly field: FormFieldResponse;
  readonly rows: readonly TableRow[];
  readonly error: string | undefined;
  readonly onChange: (rows: readonly TableRow[]) => void;
  /** Names of the files the ticket already has, by id (for the file cells). */
  readonly knownFiles: Readonly<Record<string, string>>;
  /** While a file of a cell is on its way the step cannot be sent. */
  readonly onBusyChange: (busy: boolean) => void;
}

/**
 * A TABLE field: one row per entry, a cell per column (a formula column shows what it computes, a file column takes
 * files); rows are added and removed here, and the API checks the limits.
 */
export function TableInput({ field, rows, error, onChange, knownFiles, onBusyChange }: TableInputProps) {
  const { t } = useTranslation('tickets');
  const columns = columnsOf(field);
  const maxRows = typeof field.config['maxRows'] === 'number' ? field.config['maxRows'] : 200;
  // The day the formulas see (the API uses the company's): enough for what a row formula can do with a date.
  const today = new Date().toISOString().slice(0, 10);
  const number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 6 });
  const setCell = (index: number, code: string, cell: string | readonly string[]) => onChange(rows.map((row, current) => (current === index ? { ...row, [code]: cell } : row)));
  // Several cells may be uploading at once: the step waits for all of them.
  const busyCells = useRef(new Set<string>());
  const setBusy = (key: string, busy: boolean) => {
    if (busy) busyCells.current.add(key);
    else busyCells.current.delete(key);
    onBusyChange(busyCells.current.size > 0);
  };
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
                      ) : column.type === 'FILE' ? (
                        <FileCell
                          column={column}
                          label={t('advance.table.cell', { column: column.label, row: index + 1 })}
                          value={cellFiles(row, column.code)}
                          knownNames={knownFiles}
                          onChange={(files) => setCell(index, column.code, files)}
                          onBusyChange={(busy) => setBusy(`${String(index)}:${column.code}`, busy)}
                        />
                      ) : (
                        <Cell column={column} label={t('advance.table.cell', { column: column.label, row: index + 1 })} value={cellText(row, column.code)} onChange={(text) => setCell(index, column.code, text)} />
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

const ALL_KINDS: readonly FileKind[] = ['PDF', 'IMAGE', 'OFFICE', 'ZIP'];

/** A file cell: the names of its files, each removable, and a small picker while there is room (one file by default). */
function FileCell({ column, label, value, knownNames, onChange, onBusyChange }: { readonly column: TableColumn; readonly label: string; readonly value: readonly string[]; readonly knownNames: Readonly<Record<string, string>>; readonly onChange: (files: readonly string[]) => void; readonly onBusyChange: (busy: boolean) => void }) {
  const { t } = useTranslation('tickets');
  const inputId = useId();
  const maxFiles = column.maxFiles ?? 1;
  const kinds = column.accept !== undefined && column.accept.length > 0 ? (column.accept as readonly FileKind[]) : ALL_KINDS;
  const { upload, choose, nameOf, message, accept } = useFilePicking({ kinds, maxFiles, value, knownNames, onChange, onBusyChange });
  return (
    <div className={styles.fileCell}>
      {value.map((id) => (
        <span key={id} className={styles.fileChip}>
          <span className={styles.fileName}>{nameOf(id)}</span>
          <Button variant="ghost" aria-label={t('advance.choices.remove', { value: nameOf(id) })} onClick={() => onChange(value.filter((current) => current !== id))}>
            ×
          </Button>
        </span>
      ))}
      {value.length < maxFiles && (
        <>
          <label htmlFor={inputId} className={styles.fileAdd}>
            {upload.isPending ? t('advance.files.uploading') : t('advance.table.attach')}
          </label>
          <input id={inputId} className={styles.fileInput} type="file" aria-label={label} multiple={maxFiles - value.length > 1} accept={accept} disabled={upload.isPending} onChange={choose} />
        </>
      )}
      {message !== undefined && <span className={styles.error}>{message}</span>}
      {upload.isError && <span className={styles.error}>{t('advance.files.failed')}</span>}
    </div>
  );
}

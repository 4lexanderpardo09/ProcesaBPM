import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './Table.module.css';

export interface TableColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  /** CSS width of the column, such as `96px` or `40%`. */
  readonly width?: string;
  /** Identifiers and numbers: monospaced with tabular figures. */
  readonly code?: boolean;
}

export interface TableProps<T> {
  /** Names the table for screen readers; not shown. */
  readonly label: string;
  readonly columns: readonly TableColumn<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  /** Shown in place of the rows when there are none. */
  readonly empty: ReactNode;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  /** Mouse convenience on the whole row; keep a link in a cell for the keyboard. */
  readonly onRowClick?: (row: T) => void;
  readonly footer?: ReactNode;
}

/** The main data table: overline headers, row hover and its own empty and loading states. */
export function Table<T>({ label, columns, rows, rowKey, empty, loading = false, loadingLabel, onRowClick, footer }: TableProps<T>) {
  const placeholder = loading ? loadingLabel : rows.length === 0 ? empty : undefined;
  return (
    <div className={styles.frame}>
      <div className={styles.scroll}>
        <table className={styles.table} aria-label={label} aria-busy={loading}>
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={column.width === undefined ? undefined : { width: column.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={cx('text-overline', styles.header)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {placeholder !== undefined ? (
              <tr>
                <td colSpan={columns.length} className={styles.placeholder}>
                  {placeholder}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)} className={cx(onRowClick !== undefined && styles.clickable)} onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}>
                  {columns.map((column) => (
                    <td key={column.key} className={cx(styles.cell, column.code === true && styles.code)}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer !== undefined && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}

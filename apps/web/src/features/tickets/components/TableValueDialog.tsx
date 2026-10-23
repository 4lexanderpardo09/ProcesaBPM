import type { FormFieldResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DownloadIcon } from '@/shared/ui';
import { readColumnsOf, tableCellText } from '../lib/field-value';
import { useTicketFileDownload } from '../hooks/use-ticket-file-download';
import styles from './TableValueDialog.module.css';

export interface TableValueDialogProps {
  readonly ticketId: string;
  readonly field: FormFieldResponse;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  /** The column totals the API computed (`totals[field.code]`), as decimal text. */
  readonly totals: Readonly<Record<string, string>> | undefined;
  /** Names of the ticket's files, by id. */
  readonly fileNames: Readonly<Record<string, string>>;
  readonly timeZone: string | undefined;
  readonly onClose: () => void;
}

/** The rows of a TABLE field as the ticket has them, each cell formatted like a field, with the totals and the files of its file columns to download. */
export function TableValueDialog({ ticketId, field, rows, totals, fileNames, timeZone, onClose }: TableValueDialogProps) {
  const { t } = useTranslation('tickets');
  const download = useTicketFileDownload(ticketId);
  const columns = readColumnsOf(field);
  const hasTotals = totals !== undefined && Object.keys(totals).length > 0;
  return (
    <Dialog open size="wide" title={field.label} closeLabel={t('detail.fields.close')} onClose={onClose} footer={<Button onClick={onClose}>{t('detail.fields.close')}</Button>}>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className={styles.caption}>{t('detail.fields.rows', { count: rows.length })}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.code} scope="col" className={isNumeric(column.type) ? styles.number : undefined}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              // Rows have no id of their own: their position is who they are.
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column.code} className={isNumeric(column.type) ? styles.number : undefined}>
                    {column.type === 'FILE' ? (
                      <FileCell
                        ids={Array.isArray(row[column.code]) ? (row[column.code] as unknown[]).filter((id): id is string => typeof id === 'string') : []}
                        names={fileNames}
                        disabled={download.isPending}
                        onDownload={(id) => download.mutate(id)}
                      />
                    ) : (
                      (tableCellText(column, row[column.code], timeZone) ?? '—')
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {hasTotals && (
            <tfoot>
              <tr>
                {columns.map((column, index) => (
                  <td key={column.code} className={isNumeric(column.type) ? styles.number : undefined}>
                    {totals[column.code] !== undefined ? tableCellText(column, totals[column.code], timeZone) : index === 0 ? t('detail.fields.total') : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {download.isError && <p className={styles.error}>{t('detail.attachments.downloadFailed')}</p>}
    </Dialog>
  );
}

const isNumeric = (type: string) => type === 'NUMBER' || type === 'CURRENCY' || type === 'FORMULA';

function FileCell({ ids, names, disabled, onDownload }: { readonly ids: readonly string[]; readonly names: Readonly<Record<string, string>>; readonly disabled: boolean; readonly onDownload: (id: string) => void }) {
  const { t } = useTranslation('tickets');
  if (ids.length === 0) return '—';
  return (
    <ul className={styles.files}>
      {ids.map((id) => {
        const name = names[id] ?? t('detail.fields.fileGone');
        return (
          <li key={id}>
            <Button variant="ghost" icon={<DownloadIcon size={14} />} disabled={disabled || names[id] === undefined} aria-label={t('detail.attachments.download', { name })} onClick={() => onDownload(id)}>
              {name}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

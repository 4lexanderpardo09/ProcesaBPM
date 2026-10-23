import type { TicketStepFileResponse } from '@procesabpm/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatFileSize } from '@/shared/lib/format-file-size';
import { Alert, Button, Card, DownloadIcon } from '@/shared/ui';
import { useTicketFileDownload } from '../hooks/use-ticket-file-download';
import styles from './TicketAttachments.module.css';

export interface TicketStepFilesProps {
  readonly ticketId: string;
  readonly stepFiles: UseQueryResult<readonly TicketStepFileResponse[]>;
}

/** The files the workflow gives for the step the ticket is on (a guide, a format to fill); nothing when the step has none. */
export function TicketStepFiles({ ticketId, stepFiles }: TicketStepFilesProps) {
  const { t } = useTranslation('tickets');
  const download = useTicketFileDownload(ticketId);
  if (stepFiles.data === undefined || stepFiles.data.length === 0) return null;
  return (
    <Card title={t('detail.stepFiles.title')}>
      <ul className={styles.files}>
        {stepFiles.data.map((entry) => (
          <li key={entry.file.id} className={styles.file}>
            <div className={styles.fileText}>
              <span className={styles.label}>{entry.label}</span>
              <span className={styles.meta}>
                {entry.file.name} · {formatFileSize(entry.file.sizeBytes)}
              </span>
            </div>
            <Button variant="ghost" icon={<DownloadIcon size={15} />} aria-label={t('detail.stepFiles.download', { label: entry.label })} disabled={download.isPending} onClick={() => download.mutate(entry.file.id)} />
          </li>
        ))}
      </ul>
      {download.isError && (
        <div className={styles.error}>
          <Alert tone="danger">{t('detail.attachments.downloadFailed')}</Alert>
        </div>
      )}
    </Card>
  );
}

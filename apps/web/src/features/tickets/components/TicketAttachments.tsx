import type { TicketDocumentResponse } from '@procesabpm/shared';
import { useMutation, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatFileSize } from '@/shared/lib/format-file-size';
import { formatShortDate } from '@/shared/lib/format-date-time';
import { openDownload } from '@/shared/lib/open-download';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Card, DownloadIcon } from '@/shared/ui';
import { ticketFileDownloadUrl } from '../api/ticket-detail-api';
import { LoadError } from './LoadError';
import styles from './TicketAttachments.module.css';

export interface TicketAttachmentsProps {
  readonly ticketId: string;
  readonly documents: UseQueryResult<readonly TicketDocumentResponse[]>;
  readonly timeZone: string | undefined;
}

/** The current version of every file on the ticket; the download link is asked for when the person clicks. */
export function TicketAttachments({ ticketId, documents, timeZone }: TicketAttachmentsProps) {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const download = useMutation({
    mutationFn: (fileId: string) => ticketFileDownloadUrl(client, ticketId, fileId),
    onSuccess: ({ url }) => openDownload(url),
  });
  const current = documents.data?.filter((document) => document.isCurrent);

  return (
    <Card title={t('detail.attachments.title')}>
      {documents.isError ? (
        <LoadError error={documents.error} onRetry={() => void documents.refetch()} />
      ) : current === undefined ? (
        <p className={styles.muted}>{t('detail.attachments.loading')}</p>
      ) : current.length === 0 ? (
        <p className={styles.muted}>{t('detail.attachments.empty')}</p>
      ) : (
        <ul className={styles.files}>
          {current.map((document) => (
            <li key={document.id} className={styles.file}>
              <div className={styles.fileText}>
                <span className={styles.name}>{document.file.name}</span>
                <span className={styles.meta}>
                  {formatFileSize(document.file.sizeBytes)} · {formatShortDate(document.createdAt, timeZone)}
                </span>
              </div>
              <Button
                variant="ghost"
                icon={<DownloadIcon size={15} />}
                aria-label={t('detail.attachments.download', { name: document.file.name })}
                disabled={download.isPending}
                onClick={() => download.mutate(document.file.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {download.isError && (
        <div className={styles.error}>
          <Alert tone="danger">{t('detail.attachments.downloadFailed')}</Alert>
        </div>
      )}
    </Card>
  );
}

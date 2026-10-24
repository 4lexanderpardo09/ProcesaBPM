import type { TicketDocumentJobsResponse, TicketDocumentResponse } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/shared/api';
import { formatFileSize } from '@/shared/lib/format-file-size';
import { formatShortDate } from '@/shared/lib/format-date-time';
import { useApiClient } from '@/shared/session';
import { Alert, Badge, Button, Card, DownloadIcon } from '@/shared/ui';
import { downloadCombinedDocuments, regenerateTicketDocument, ticketDocumentJobsQueryOptions } from '../api/ticket-detail-api';
import { ticketQueryKeys } from '../api/tickets-api';
import { useTicketFileDownload } from '../hooks/use-ticket-file-download';
import { LoadError } from './LoadError';
import { PdfViewerDialog } from './PdfViewerDialog';
import styles from './TicketAttachments.module.css';

/** What the combined PDF takes: PDFs and the images a PDF can draw. */
const COMBINABLE = new Set(['application/pdf', 'image/png', 'image/jpeg']);

export interface TicketAttachmentsProps {
  readonly ticketId: string;
  /** The ticket's number, for the name of the combined PDF. */
  readonly number: string;
  readonly documents: UseQueryResult<readonly TicketDocumentResponse[]>;
  readonly timeZone: string | undefined;
}

/** The current version of every file on the ticket, and the workflow's documents being drawn or that failed. */
export function TicketAttachments({ ticketId, number, documents, timeZone }: TicketAttachmentsProps) {
  const { t } = useTranslation('tickets');
  const download = useTicketFileDownload(ticketId);
  const [viewing, setViewing] = useState<{ readonly id: string; readonly name: string } | undefined>(undefined);
  const current = documents.data?.filter((document) => document.isCurrent);
  const client = useApiClient();
  const combined = useMutation({ mutationFn: () => downloadCombinedDocuments(client, ticketId, number) });
  const combinable = (current ?? []).filter((document) => COMBINABLE.has(document.file.mimeType)).length;

  return (
    <Card
      title={t('detail.attachments.title')}
      actions={
        combinable > 1 ? (
          <Button variant="ghost" icon={<DownloadIcon size={15} />} title={t('detail.attachments.combinedHint')} disabled={combined.isPending} onClick={() => combined.mutate()}>
            {combined.isPending ? t('detail.attachments.combining') : t('detail.attachments.combined')}
          </Button>
        ) : undefined
      }
    >
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
              {document.file.mimeType === 'application/pdf' && (
                <Button variant="ghost" aria-label={t('detail.viewer.view', { name: document.file.name })} onClick={() => setViewing({ id: document.file.id, name: document.file.name })}>
                  {t('detail.attachments.view')}
                </Button>
              )}
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
      {combined.isError && (
        <div className={styles.error}>
          <Alert tone="danger">{combined.error instanceof ApiError && combined.error.code === 'DOCUMENTS_TOO_LARGE' ? t('detail.attachments.combinedTooLarge') : t('detail.attachments.combinedFailed')}</Alert>
        </div>
      )}
      <DocumentJobs ticketId={ticketId} />
      {viewing !== undefined && <PdfViewerDialog ticketId={ticketId} file={viewing} onClose={() => setViewing(undefined)} />}
    </Card>
  );
}

type JobDocument = TicketDocumentJobsResponse['documents'][number];

/**
 * The workflow's documents for this ticket: one being drawn or that failed says so, and whoever may edit the ticket can
 * draw one again (its data changed, or it failed). When a drawing ends, the list of files is asked for again.
 */
function DocumentJobs({ ticketId }: { readonly ticketId: string }) {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const jobs = useQuery(ticketDocumentJobsQueryOptions(client, ticketId));
  const regenerate = useMutation({
    mutationFn: (workflowDocumentId: string) => regenerateTicketDocument(client, ticketId, workflowDocumentId),
    onSuccess: (data) => queryClient.setQueryData(ticketQueryKeys.documentJobs(ticketId), data),
  });
  const generating = jobs.data?.documents.filter((document) => document.state === 'GENERATING').length ?? 0;
  const wasGenerating = useRef(generating);
  useEffect(() => {
    if (generating < wasGenerating.current) void queryClient.invalidateQueries({ queryKey: ticketQueryKeys.documents(ticketId) });
    wasGenerating.current = generating;
  }, [generating, queryClient, ticketId]);

  const data = jobs.data;
  if (data === undefined) return null;
  const shown = data.documents.filter((document) => document.state !== null || data.canRegenerate);
  if (shown.length === 0) return null;
  return (
    <div className={styles.jobs}>
      <h4 className={styles.jobsTitle}>{t('detail.documentJobs.title')}</h4>
      <ul className={styles.files}>
        {shown.map((document) => (
          <li key={document.workflowDocumentId} className={styles.file}>
            <div className={styles.fileText}>
              <span className={styles.label}>{document.name}</span>
            </div>
            <JobState document={document} />
            {data.canRegenerate && document.state !== 'GENERATING' && (
              <Button variant="ghost" disabled={regenerate.isPending} aria-label={t('detail.documentJobs.regenerateNamed', { name: document.name })} onClick={() => regenerate.mutate(document.workflowDocumentId)}>
                {t('detail.documentJobs.regenerate')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {regenerate.isError && <Alert tone="danger">{t('detail.documentJobs.regenerateFailed')}</Alert>}
    </div>
  );
}

function JobState({ document }: { readonly document: JobDocument }) {
  const { t } = useTranslation('tickets');
  if (document.state === 'GENERATING') return <Badge tone="accent">{t('detail.documentJobs.generating')}</Badge>;
  if (document.state === 'FAILED') return <Badge tone="danger">{t('detail.documentJobs.failed')}</Badge>;
  return null;
}

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type LoadedPdf, loadPdf } from '@/shared/lib/pdf-pages';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Dialog, DownloadIcon } from '@/shared/ui';
import { ticketFileDownloadUrl } from '../api/ticket-detail-api';
import { useTicketFileDownload } from '../hooks/use-ticket-file-download';
import styles from './PdfViewerDialog.module.css';

/** Pages drawn in the window; past them the file is downloaded to read on. */
const MAX_PAGES = 30;

export interface PdfViewerDialogProps {
  readonly ticketId: string;
  readonly file: { readonly id: string; readonly name: string };
  readonly onClose: () => void;
}

/**
 * A PDF of the ticket read in place, page after page at the window's width, without downloading it. When it cannot be shown (the bucket
 * does not let the page read it, a damaged file) it is downloaded instead, as the help desk always did, so the person still gets to read it.
 */
export function PdfViewerDialog({ ticketId, file, onClose }: PdfViewerDialogProps) {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const download = useTicketFileDownload(ticketId);
  const pdf = useQuery({
    queryKey: ['tickets', ticketId, 'pdf-view', file.id],
    queryFn: async () => loadPdf((await ticketFileDownloadUrl(client, ticketId, file.id)).url),
    // The link expires and the document holds a worker: it is opened for this window and let go with it.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  useEffect(() => () => pdf.data?.destroy(), [pdf.data]);
  const downloadOnce = useRef(download.mutate);
  useEffect(() => {
    if (pdf.isError) downloadOnce.current(file.id);
  }, [pdf.isError, file.id]);

  return (
    <Dialog
      open
      size="wide"
      title={file.name}
      closeLabel={t('actions.dismiss')}
      onClose={onClose}
      footer={
        <Button icon={<DownloadIcon size={15} />} disabled={download.isPending} onClick={() => download.mutate(file.id)}>
          {t('detail.viewer.download')}
        </Button>
      }
    >
      {pdf.isError ? (
        <Alert tone="danger">{t('detail.viewer.failed')}</Alert>
      ) : pdf.data === undefined ? (
        <p className={styles.note}>{t('detail.viewer.loading')}</p>
      ) : (
        <PdfPages pdf={pdf.data} />
      )}
      {download.isError && <Alert tone="danger">{t('detail.attachments.downloadFailed')}</Alert>}
    </Dialog>
  );
}

function PdfPages({ pdf }: { readonly pdf: LoadedPdf }) {
  const { t } = useTranslation('tickets');
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const shown = Math.min(pdf.pages.length, MAX_PAGES);
  return (
    <div ref={frame} className={styles.pages}>
      {width > 0 && Array.from({ length: shown }, (_, index) => <PdfPage key={index} pdf={pdf} pageNumber={index + 1} width={width} />)}
      {pdf.pages.length > shown && <p className={styles.note}>{t('detail.viewer.more', { shown, total: pdf.pages.length })}</p>}
    </div>
  );
}

function PdfPage({ pdf, pageNumber, width }: { readonly pdf: LoadedPdf; readonly pageNumber: number; readonly width: number }) {
  const { t } = useTranslation('tickets');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const page = pdf.pages[pageNumber - 1]!;
  useEffect(() => {
    if (canvas.current === null) return;
    setFailed(false);
    // Drawn at the screen's density, shown at the window's width.
    pdf.render(pageNumber, canvas.current, (width / page.width) * (window.devicePixelRatio || 1)).catch(() => setFailed(true));
  }, [pdf, pageNumber, page.width, width]);
  return failed ? (
    <p className={styles.note}>{t('detail.viewer.pageFailed', { page: pageNumber })}</p>
  ) : (
    <canvas ref={canvas} className={styles.page} style={{ aspectRatio: `${String(page.width)} / ${String(page.height)}` }} aria-label={t('detail.viewer.page', { page: pageNumber, pages: pdf.pages.length })} />
  );
}

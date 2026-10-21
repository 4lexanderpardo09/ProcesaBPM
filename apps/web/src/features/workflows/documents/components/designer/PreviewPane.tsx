import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Button } from '@/shared/ui';
import { previewPdfFormat } from '../../api/documents-api';
import { DocumentError } from '../DocumentError';
import styles from './Designer.module.css';

export interface PreviewPaneProps {
  readonly workflowId: string;
  readonly formatId: string;
  /** Changes when a new version is saved: the preview follows it. */
  readonly savedAt: string;
  readonly dirty: boolean;
}

/** The saved format drawn by the API with sample values, as a ticket would get it. */
export function PreviewPane({ workflowId, formatId, savedAt, dirty }: PreviewPaneProps) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const preview = useQuery({
    queryKey: ['pdf-preview', workflowId, formatId, savedAt],
    queryFn: () => previewPdfFormat(client, workflowId, formatId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
  const url = useObjectUrl(preview.data);
  return (
    <section className={styles.preview} aria-labelledby="pdf-preview-title">
      <header className={styles.previewHeader}>
        <h2 id="pdf-preview-title" className={styles.bandTitle}>
          {t('documents.designer.preview')}
        </h2>
        <Button variant="ghost" disabled={preview.isFetching} onClick={() => void preview.refetch()}>
          {preview.isFetching ? t('loading') : t('documents.designer.refresh')}
        </Button>
      </header>
      <p className={styles.note}>{dirty ? t('documents.designer.previewDirty') : t('documents.designer.previewHint')}</p>
      <DocumentError error={preview.error} />
      {url !== undefined && <iframe className={styles.previewFrame} title={t('documents.designer.previewFrame')} src={url} />}
    </section>
  );
}

/** A URL for the blob while it is shown, released when it changes or the pane goes away. */
function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (blob === undefined) return undefined;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

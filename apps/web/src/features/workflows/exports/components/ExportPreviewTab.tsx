import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { exportPreviewQueryOptions } from '../api/exports-api';
import styles from './Exports.module.css';

/** How the row of the workflow's newest ticket comes out with the saved definition. */
export function ExportPreviewTab({ exportId }: { readonly exportId: string }) {
  const { t } = useTranslation('workflows');
  const preview = useQuery(exportPreviewQueryOptions(useApiClient(), exportId));
  if (preview.data === undefined) return <p className={styles.note}>{preview.isError ? t('loadFailed') : t('loading')}</p>;
  return (
    <div className={styles.form}>
      <p className={styles.note}>{preview.data.ticketNumber === null ? t('exports.preview.none') : t('exports.preview.hint', { number: preview.data.ticketNumber })}</p>
      <dl className={styles.preview}>
        {Object.entries(preview.data.row).map(([header, value]) => (
          <div key={header} style={{ display: 'contents' }}>
            <dt>{header}</dt>
            <dd>{value === '' ? '—' : value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

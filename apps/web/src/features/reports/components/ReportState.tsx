import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/shared/api';
import { Alert } from '@/shared/ui';
import styles from './Reports.module.css';

/** Why a report could not be shown, in words: too large or too slow ask to narrow the filters. */
export function ReportError({ error }: { readonly error: unknown }) {
  const { t } = useTranslation('reports');
  if (error instanceof ApiError && error.code === 'REPORT_TOO_LARGE') return <Alert tone="warn">{t('tooLarge')}</Alert>;
  if (error instanceof ApiError && error.code === 'REPORT_TIMEOUT') return <Alert tone="warn">{t('timeout')}</Alert>;
  if (error instanceof ApiError && error.status === 403) return <Alert tone="danger">{t('forbidden')}</Alert>;
  return <Alert tone="danger">{t('loadFailed')}</Alert>;
}

/** A report while it loads, when it fails, or its content once it has data. */
export function ReportState<T>({ query, children }: { readonly query: UseQueryResult<T>; readonly children: (data: T) => ReactNode }) {
  const { t } = useTranslation('reports');
  if (query.data !== undefined) return <div className={query.isFetching ? styles.refreshing : undefined}>{children(query.data)}</div>;
  if (query.isError) return <ReportError error={query.error} />;
  return <p className={styles.note}>{t('loading')}</p>;
}

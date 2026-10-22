import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatFileSize } from '@/shared/lib/format-file-size';
import { useApiClient } from '@/shared/session';
import { Alert, Card } from '@/shared/ui';
import { storageQueryOptions } from '../api/settings-api';
import styles from './Settings.module.css';

/** How much of the plan's space the organization's files take; past the limit, new uploads are refused. */
export function StorageTab() {
  const { t } = useTranslation('settings');
  const usage = useQuery(storageQueryOptions(useApiClient()));
  const data = usage.data;
  if (data === undefined) return <p className={styles.note}>{usage.isError ? t('loadFailed') : t('loading')}</p>;
  const used = Number(data.usedBytes);
  const limit = Number(data.limitBytes);
  const share = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <Card title={t('storage.title')}>
      <div className={styles.stack}>
        <p className={styles.strong}>{t('storage.used', { used: formatFileSize(used), limit: formatFileSize(limit), share })}</p>
        <div className={styles.meter} role="meter" aria-label={t('storage.meter')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} data-state={data.state}>
          <span style={{ width: `${String(share)}%` }} />
        </div>
        {Number(data.reservedBytes) > 0 && <p className={styles.note}>{t('storage.reserved', { size: formatFileSize(Number(data.reservedBytes)) })}</p>}
        <p className={styles.note}>{t('storage.users', { count: data.activeUsers })}</p>
        {data.state === 'OVER_LIMIT' && <Alert tone="warn">{t('storage.overLimit', { hard: formatFileSize(Number(data.hardLimitBytes)) })}</Alert>}
        {data.state === 'BLOCKED' && <Alert tone="danger">{t('storage.blocked')}</Alert>}
      </div>
    </Card>
  );
}

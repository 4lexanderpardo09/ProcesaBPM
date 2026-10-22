import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Alert, Card, Checkbox } from '@/shared/ui';
import { saveSecurity, securityQueryOptions, settingsQueryKeys } from '../api/settings-api';
import { SettingsError } from './SettingsError';
import styles from './Settings.module.css';

/** The organization's security policy: whether every member must use two-step verification. */
export function SecurityTab() {
  const { t } = useTranslation('settings');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const security = useQuery(securityQueryOptions(client));
  const save = useMutation({
    mutationFn: (mfaRequired: boolean) => saveSecurity(client, { mfaRequired }),
    onSuccess: (saved) => queryClient.setQueryData(settingsQueryKeys.security, saved),
  });
  const data = security.data;
  return (
    <Card title={t('security.title')}>
      <div className={styles.stack}>
        {data === undefined ? (
          <p className={styles.note}>{security.isError ? t('loadFailed') : t('loading')}</p>
        ) : (
          <>
            <Checkbox label={t('security.mfaRequired')} checked={data.mfaRequired} disabled={save.isPending} onChange={(event) => save.mutate(event.target.checked)} />
            <p className={styles.note}>{t('security.mfaHint')}</p>
            {data.mfaRequired && data.activeMembersWithoutMfa > 0 && <Alert tone="warn">{t('security.pending', { count: data.activeMembersWithoutMfa })}</Alert>}
          </>
        )}
        <SettingsError error={save.error} />
      </div>
    </Card>
  );
}

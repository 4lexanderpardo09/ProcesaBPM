import { NOTIFICATION_TYPES, type NotificationTypeValue } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Card } from '@/shared/ui';
import { preferencesQueryOptions, savePreference, toolsQueryKeys } from '../api/profile-api';
import { ProfileError } from './ProfileError';
import styles from './Profile.module.css';

type Channels = { readonly inApp: boolean; readonly email: boolean };
type Preference = Channels & { readonly type: NotificationTypeValue };

/**
 * Which notifications arrive in the application and which by e-mail, per kind. Each box saves at once; the list
 * shows the change before the API answers and goes back if it fails.
 */
export function NotificationsCard() {
  const { t } = useTranslation('profile');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const preferences = useQuery(preferencesQueryOptions(client));
  const save = useMutation({
    mutationFn: ({ type, channels }: { type: NotificationTypeValue; channels: Channels }) => savePreference(client, type, channels),
    onMutate: async ({ type, channels }) => {
      await queryClient.cancelQueries({ queryKey: toolsQueryKeys.preferences });
      const before = queryClient.getQueryData<Preference[]>(toolsQueryKeys.preferences);
      queryClient.setQueryData<Preference[]>(toolsQueryKeys.preferences, (rows) => rows?.map((row) => (row.type === type ? { type, ...channels } : row)));
      return { before };
    },
    onError: (_error, _change, context) => queryClient.setQueryData(toolsQueryKeys.preferences, context?.before),
  });
  const byType = new Map((preferences.data ?? []).map((row) => [row.type, row]));

  return (
    <Card title={t('notifications.title')}>
      <div className={styles.form}>
        <p className={styles.note}>{t('notifications.hint')}</p>
        <ProfileError error={save.error} />
        {preferences.data === undefined ? (
          <p className={styles.note}>{preferences.isError ? t('loadFailed') : t('loading')}</p>
        ) : (
          <table className={styles.preferences}>
            <thead>
              <tr>
                <th scope="col">{t('notifications.kind')}</th>
                <th scope="col">{t('notifications.inApp')}</th>
                <th scope="col">{t('notifications.email')}</th>
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_TYPES.map((type) => {
                const row = byType.get(type) ?? { type, inApp: true, email: false };
                const label = t(`notifications.types.${type}`);
                return (
                  <tr key={type}>
                    <th scope="row">{label}</th>
                    {(['inApp', 'email'] as const).map((channel) => (
                      <td key={channel}>
                        <input
                          type="checkbox"
                          aria-label={t(channel === 'inApp' ? 'notifications.inAppNamed' : 'notifications.emailNamed', { kind: label })}
                          checked={row[channel]}
                          onChange={(event) => save.mutate({ type, channels: { inApp: row.inApp, email: row.email, [channel]: event.target.checked } })}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

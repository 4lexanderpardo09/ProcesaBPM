import { NOTIFICATION_TYPES, type NotificationTypeValue } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Card } from '@/shared/ui';
import { preferencesQueryOptions, savePreference, toolsQueryKeys } from '../api/profile-api';
import { ProfileError } from './ProfileError';
import styles from './Profile.module.css';

type Channels = { readonly inApp: boolean; readonly email: boolean };
type Preference = Channels & { readonly type: NotificationTypeValue };

/**
 * Which notifications arrive in the application and which by e-mail, per kind. Each box saves at once.
 */
export function NotificationsCard() {
  const { t } = useTranslation('profile');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const preferences = useQuery(preferencesQueryOptions(client));
  // What was just clicked shows at once, before the API answers; it goes back if the API refuses.
  const [pending, setPending] = useState<ReadonlyMap<NotificationTypeValue, Channels>>(new Map());
  const settle = (type: NotificationTypeValue) =>
    setPending((current) => {
      const next = new Map(current);
      next.delete(type);
      return next;
    });
  const save = useMutation({
    mutationFn: ({ type, channels }: { type: NotificationTypeValue; channels: Channels }) => savePreference(client, type, channels),
    onSuccess: (saved) => queryClient.setQueryData<Preference[]>(toolsQueryKeys.preferences, (rows = []) => [...rows.filter((row) => row.type !== saved.type), saved]),
    onSettled: (_saved, _error, { type }) => settle(type),
  });
  const change = (type: NotificationTypeValue, channels: Channels) => {
    setPending((current) => new Map(current).set(type, channels));
    save.mutate({ type, channels });
  };
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
                const row = pending.get(type) ?? byType.get(type) ?? { type, inApp: true, email: false };
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
                          onChange={(event) => change(type, { inApp: row.inApp, email: row.email, [channel]: event.target.checked })}
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

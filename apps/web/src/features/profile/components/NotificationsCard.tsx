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
type Preference = Channels & { readonly type: NotificationTypeValue; readonly emailLocked: boolean };

/**
 * Which notifications arrive in the application and which by e-mail, per kind. Each box saves at once. An e-mail the
 * organization turned off shows unchecked and disabled, with the reason.
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
                const saved = byType.get(type);
                const row = pending.get(type) ?? saved ?? { inApp: true, email: false };
                const locked = saved?.emailLocked ?? false;
                const label = t(`notifications.types.${type}`);
                return (
                  <tr key={type}>
                    <th scope="row">{label}</th>
                    {(['inApp', 'email'] as const).map((channel) => {
                      const disabled = channel === 'email' && locked;
                      return (
                        <td key={channel}>
                          <input
                            type="checkbox"
                            aria-label={t(channel === 'inApp' ? 'notifications.inAppNamed' : 'notifications.emailNamed', { kind: label })}
                            aria-describedby={disabled ? `email-locked-${type}` : undefined}
                            checked={disabled ? false : row[channel]}
                            disabled={disabled}
                            onChange={(event) => change(type, { inApp: row.inApp, email: row.email, [channel]: event.target.checked })}
                          />
                          {disabled && (
                            <span id={`email-locked-${type}`} className={styles.locked}>
                              {t('notifications.emailLocked')}
                            </span>
                          )}
                        </td>
                      );
                    })}
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

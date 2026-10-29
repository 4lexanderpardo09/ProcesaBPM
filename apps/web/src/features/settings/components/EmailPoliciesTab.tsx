import { EMAIL_POLICY_TYPES, type EmailPolicyTypeValue, NOTIFICATION_EMAIL_POLICIES, type NotificationEmailPolicyResponse, type NotificationEmailPolicyValue } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Card, Select } from '@/shared/ui';
import { emailPoliciesQueryOptions, saveEmailPolicy, settingsQueryKeys } from '../api/settings-api';
import { SettingsError } from './SettingsError';
import styles from './Settings.module.css';

/**
 * Which ticket notices may go out by e-mail, for the whole organization: never, only to whoever turns them on, or to
 * everyone who does not turn them off. Each choice saves at once; the people's own choices live in their profile.
 */
export function EmailPoliciesTab() {
  const { t } = useTranslation('settings');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const policies = useQuery(emailPoliciesQueryOptions(client));
  const save = useMutation({
    mutationFn: ({ type, policy }: { type: EmailPolicyTypeValue; policy: NotificationEmailPolicyValue }) => saveEmailPolicy(client, type, policy),
    onSuccess: (saved) => queryClient.setQueryData<NotificationEmailPolicyResponse[]>(settingsQueryKeys.emailPolicies, (rows = []) => rows.map((row) => (row.type === saved.type ? saved : row))),
  });
  const byType = new Map((policies.data ?? []).map((row) => [row.type, row]));
  const options = NOTIFICATION_EMAIL_POLICIES.map((policy) => ({ value: policy, label: t(`emails.policies.${policy}`) }));

  return (
    <Card title={t('emails.title')}>
      <div className={styles.stack}>
        <p className={styles.note}>{t('emails.hint')}</p>
        <SettingsError error={save.error} />
        {policies.data === undefined ? (
          <p className={styles.note}>{policies.isError ? t('loadFailed') : t('loading')}</p>
        ) : (
          <div className={styles.policyGrid}>
            {EMAIL_POLICY_TYPES.map((type) => {
              const row = byType.get(type);
              if (row === undefined) return null;
              return (
                <Select
                  key={type}
                  label={t(`notifications.types.${type}`, { ns: 'profile' })}
                  hint={row.chosen ? undefined : t('emails.builtIn')}
                  options={options}
                  value={row.policy}
                  disabled={save.isPending}
                  onChange={(event) => save.mutate({ type, policy: event.target.value as NotificationEmailPolicyValue })}
                />
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

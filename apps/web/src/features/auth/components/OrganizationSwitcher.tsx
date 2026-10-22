import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { canOpen, myOrganizationsQueryOptions } from '../api/organizations-api';
import { useSwitchOrganization } from '../hooks/use-switch-organization';
import { StepError } from './StepError';
import styles from './OrganizationSwitcher.module.css';

/** The organization of the session, in the top bar; with more than one to open, a list to move to another. */
export function OrganizationSwitcher() {
  const { t } = useTranslation('auth');
  const { data: me } = useCurrentUser();
  const organizations = useQuery(myOrganizationsQueryOptions(useApiClient()));
  const change = useSwitchOrganization();
  if (me === undefined) return null;
  const current = me.organization;
  const others = (organizations.data ?? []).filter((organization) => organization.tenantId !== current.id && canOpen(organization));
  if (others.length === 0) return <span className={styles.name}>{current.name}</span>;
  return (
    <div className={styles.switcher}>
      <select
          className={styles.select}
          aria-label={t('organizations.switcherLabel')}
          value={current.id}
          disabled={change.isPending}
          onChange={(event) => {
            if (event.target.value !== current.id) change.mutate({ tenantId: event.target.value });
          }}
        >
          <option value={current.id}>{current.name}</option>
          {others.map((organization) => (
            <option key={organization.tenantId} value={organization.tenantId}>
              {organization.name}
            </option>
          ))}
        </select>
      {change.error !== null && <StepError error={change.error} context="selection" />}
    </div>
  );
}

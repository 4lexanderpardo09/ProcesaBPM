import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { paths } from '@/shared/lib/paths';
import { usePermissions } from '@/shared/session';
import { PageHeader, Tabs } from '@/shared/ui';
import { AuditTab } from '../components/AuditTab';
import { CalculatorsTab } from '../components/CalculatorsTab';
import { OrganizationTab } from '../components/OrganizationTab';
import { SecurityTab } from '../components/SecurityTab';
import styles from '../components/Settings.module.css';
import { StorageTab } from '../components/StorageTab';
import { SupportAccessTab } from '../components/SupportAccessTab';

const TABS = [
  { value: 'security', action: 'update', subject: 'Setting' },
  { value: 'organization', action: 'update', subject: 'Setting' },
  { value: 'calculators', action: 'update', subject: 'Setting' },
  { value: 'support', action: 'manage', subject: 'SupportAccess' },
  { value: 'storage', action: 'read', subject: 'Storage' },
  { value: 'audit', action: 'read', subject: 'AuditLog' },
] as const;
type SettingsTab = (typeof TABS)[number]['value'];

/** The organization's own settings, a tab per area the role may use; the tab is in the path (`/settings/storage`). */
export function SettingsPage() {
  const { t } = useTranslation('settings');
  const { can, loaded } = usePermissions();
  const { tab } = useParams();
  const navigate = useNavigate();
  const tabs = TABS.filter((candidate) => can(candidate.action, candidate.subject));
  if (!loaded) return <p className={styles.note}>{t('loading')}</p>;
  if (tabs.length === 0) return <Navigate to={paths.home} replace />;
  const current: SettingsTab = tabs.find((candidate) => candidate.value === tab)?.value ?? tabs[0]!.value;
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className={styles.tabs}>
        <Tabs label={t('tabsLabel')} items={tabs.map((candidate) => ({ value: candidate.value, label: t(`tabs.${candidate.value}`) }))} value={current} onChange={(next) => void navigate(`${paths.settings}/${next}`, { replace: true })} />
      </div>
      {current === 'organization' && <OrganizationTab />}
      {current === 'security' && <SecurityTab />}
      {current === 'calculators' && <CalculatorsTab />}
      {current === 'support' && <SupportAccessTab />}
      {current === 'storage' && <StorageTab />}
      {current === 'audit' && <AuditTab />}
    </>
  );
}

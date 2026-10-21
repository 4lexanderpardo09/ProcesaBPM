import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePermissions } from '@/shared/session';
import { PageHeader, Tabs } from '@/shared/ui';
import { CompaniesTab } from '../components/CompaniesTab';
import { NamedRecordsTab } from '../components/NamedRecordsTab';
import { SitesTab } from '../components/SitesTab';
import styles from '../components/Organization.module.css';

const TABS = [
  { value: 'companies', subject: 'Company' },
  { value: 'sites', subject: 'Site' },
  { value: 'departments', subject: 'Department' },
  { value: 'positions', subject: 'Position' },
] as const;
type OrganizationTab = (typeof TABS)[number]['value'];

/** How the organization is laid out: companies, the tree of sites, departments and positions; each tab only if it can be read. */
export function OrganizationPage() {
  const { t } = useTranslation('organization');
  const { can, loaded } = usePermissions();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((tab) => can('read', tab.subject));
  const current: OrganizationTab | undefined = tabs.find((tab) => tab.value === params.get('tab'))?.value ?? tabs[0]?.value;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {current === undefined ? (
        loaded && <p className={styles.note}>{t('noAccess')}</p>
      ) : (
        <>
          <div className={styles.tabs}>
            <Tabs label={t('tabsLabel')} items={tabs.map((tab) => ({ value: tab.value, label: t(`tabs.${tab.value}`) }))} value={current} onChange={(tab) => setParams({ tab }, { replace: true })} />
          </div>
          {current === 'companies' && <CompaniesTab />}
          {current === 'sites' && <SitesTab />}
          {current === 'departments' && <NamedRecordsTab key="departments" path="/departments" subject="Department" kind="departments" />}
          {current === 'positions' && <NamedRecordsTab key="positions" path="/positions" subject="Position" kind="positions" />}
        </>
      )}
    </>
  );
}

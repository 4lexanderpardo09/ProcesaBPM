import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePermissions } from '@/shared/session';
import { PageHeader, Tabs } from '@/shared/ui';
import { ApprovalsTab } from '../components/ApprovalsTab';
import { DelegationsTab } from '../components/DelegationsTab';
import { GroupsTab } from '../components/GroupsTab';
import { MembersTab } from '../components/MembersTab';
import { RolesTab } from '../components/RolesTab';
import styles from '../components/People.module.css';

/** Each tab and what lets the person see it; delegations, only to whoever manages everyone's. */
const TABS = [
  { value: 'members', check: ['read', 'Membership'] },
  { value: 'roles', check: ['read', 'Role'] },
  { value: 'groups', check: ['read', 'Group'] },
  { value: 'approvals', check: ['read', 'ApprovalGroup'] },
  { value: 'delegations', check: ['manage', 'Delegation'] },
] as const;
type PeopleTab = (typeof TABS)[number]['value'];

/** The people of the organization, their roles, groups, approval groups and delegations; each tab only if it can be read. */
export function PeoplePage() {
  const { t } = useTranslation('people');
  const { can, loaded } = usePermissions();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((tab) => can(tab.check[0], tab.check[1]));
  const current: PeopleTab | undefined = tabs.find((tab) => tab.value === params.get('tab'))?.value ?? tabs[0]?.value;

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
          {current === 'members' && <MembersTab />}
          {current === 'roles' && <RolesTab />}
          {current === 'groups' && <GroupsTab />}
          {current === 'approvals' && <ApprovalsTab />}
          {current === 'delegations' && <DelegationsTab />}
        </>
      )}
    </>
  );
}

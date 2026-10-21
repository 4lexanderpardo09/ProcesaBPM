import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCurrentUser } from '@/shared/session';
import { PageHeader, Tabs } from '@/shared/ui';
import { MfaCard } from '../components/MfaCard';
import { MyDelegationsCard } from '../components/MyDelegationsCard';
import { NotificationsCard } from '../components/NotificationsCard';
import { PasswordCard } from '../components/PasswordCard';
import { PersonalDataCard } from '../components/PersonalDataCard';
import { SignatureCard } from '../components/SignatureCard';
import { TagsCard } from '../components/TagsCard';
import { TemplatesCard } from '../components/TemplatesCard';
import styles from '../components/Profile.module.css';

const TABS = ['data', 'security', 'signature', 'notifications', 'tags', 'templates', 'delegations'] as const;
type ProfileTab = (typeof TABS)[number];

/**
 * The person's own account and tools: data, password and second factor, signature, which notifications reach them, their
 * tags, text templates and delegations. Every member has it.
 */
export function ProfilePage() {
  const { t } = useTranslation('profile');
  const { data: me } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const current: ProfileTab = TABS.find((tab) => tab === params.get('tab')) ?? 'data';

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className={styles.tabs}>
        <Tabs label={t('tabsLabel')} items={TABS.map((tab) => ({ value: tab, label: t(`tabs.${tab}`) }))} value={current} onChange={(tab) => setParams({ tab }, { replace: true })} />
      </div>
      <div className={styles.stack}>
        {current === 'data' && me !== undefined && <PersonalDataCard key={me.user.id} me={me} />}
        {current === 'security' && (
          <>
            <PasswordCard />
            <MfaCard />
          </>
        )}
        {current === 'signature' && <SignatureCard />}
        {current === 'notifications' && <NotificationsCard />}
        {current === 'tags' && <TagsCard />}
        {current === 'templates' && <TemplatesCard />}
        {current === 'delegations' && <MyDelegationsCard />}
      </div>
    </>
  );
}

import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCurrentUser } from '@/shared/session';
import { PageHeader, Tabs } from '@/shared/ui';
import { MfaCard } from '../components/MfaCard';
import { PasswordCard } from '../components/PasswordCard';
import { PersonalDataCard } from '../components/PersonalDataCard';
import { SignatureCard } from '../components/SignatureCard';
import styles from '../components/Profile.module.css';

const TABS = ['data', 'security', 'signature'] as const;
type ProfileTab = (typeof TABS)[number];

/** The person's own account: their data, password and second factor, and signature. Every member has it. */
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
      </div>
    </>
  );
}

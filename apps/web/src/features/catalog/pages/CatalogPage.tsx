import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePermissions } from '@/shared/session';
import { PageHeader, Tabs } from '@/shared/ui';
import { CategoriesTab } from '../components/categories/CategoriesTab';
import { ErrorTypesTab } from '../components/error-types/ErrorTypesTab';
import { PrioritiesTab } from '../components/priorities/PrioritiesTab';
import styles from '../components/Catalog.module.css';

const TABS = [
  { value: 'categories', subject: 'Category' },
  { value: 'priorities', subject: 'Priority' },
  { value: 'error-types', subject: 'ErrorType' },
] as const;
type CatalogTab = (typeof TABS)[number]['value'];

/** The organization's catalog: categories and subcategories, priorities and error types; each tab only if it can be read. */
export function CatalogPage() {
  const { t } = useTranslation(['catalog', 'admin']);
  const { can, loaded } = usePermissions();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((tab) => can('read', tab.subject));
  const asked = params.get('tab');
  const current: CatalogTab | undefined = tabs.find((tab) => tab.value === asked)?.value ?? tabs[0]?.value;

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
          {current === 'categories' && <CategoriesTab />}
          {current === 'priorities' && <PrioritiesTab />}
          {current === 'error-types' && <ErrorTypesTab />}
        </>
      )}
    </>
  );
}

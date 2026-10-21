import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { ApiError } from '@/shared/api';
import { paths } from '@/shared/lib/paths';
import { useApiClient, usePermissions } from '@/shared/session';
import { Alert, Breadcrumb, Button, PageHeader, Tabs } from '@/shared/ui';
import { allWorkflowsQueryOptions, workflowQueryOptions } from '../api/workflows-api';
import { EditWorkflowDialog } from '../components/EditWorkflowDialog';
import { ObserversCard } from '../components/ObserversCard';
import { VersionsCard } from '../components/VersionsCard';
import styles from '../components/Workflows.module.css';

const TABS = ['versions', 'observers'] as const;
type WorkflowTab = (typeof TABS)[number];
const NOT_FOUND = 404;

/** One workflow: its versions (open, create a draft, delete it) and who observes its tickets. */
export function WorkflowPage() {
  const { workflowId = '' } = useParams();
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const canEdit = usePermissions().can('update', 'Workflow');
  const workflow = useQuery(workflowQueryOptions(client, workflowId));
  // The list already names the subcategory and its category; the detail only has its id.
  const listed = useQuery(allWorkflowsQueryOptions(client)).data?.find((row) => row.id === workflowId);
  const [params, setParams] = useSearchParams();
  const current: WorkflowTab = TABS.find((tab) => tab === params.get('tab')) ?? 'versions';
  const [editing, setEditing] = useState(false);

  const breadcrumb = (name: string) => <Breadcrumb label={t('detail.breadcrumb')} items={[{ label: t('detail.back'), to: paths.workflows }, { label: name }]} />;
  if (workflow.isError) {
    return (
      <>
        {breadcrumb(t('title'))}
        <Alert tone="danger">{workflow.error instanceof ApiError && workflow.error.status === NOT_FOUND ? t('detail.notFound') : t('loadFailed')}</Alert>
      </>
    );
  }
  const data = workflow.data;
  if (data === undefined) return <p className={styles.note}>{t('loading')}</p>;
  const published = data.versions.find((version) => version.status === 'PUBLISHED');

  return (
    <>
      {breadcrumb(data.name)}
      <PageHeader
        title={data.name}
        subtitle={listed === undefined ? undefined : t('list.subcategoryPath', { category: listed.subcategory.category.name, subcategory: listed.subcategory.name })}
        actions={canEdit ? <Button onClick={() => setEditing(true)}>{t('detail.edit')}</Button> : undefined}
      />
      <div className={styles.stack}>
        {!data.isActive && <Alert tone="warn">{t('detail.inactiveNotice')}</Alert>}
        {data.isActive && published === undefined && <Alert tone="info">{t('detail.unpublishedNotice')}</Alert>}
        <div>
          <div className={styles.tabs}>
            <Tabs label={t('detail.tabsLabel')} items={TABS.map((tab) => ({ value: tab, label: t(`detail.tabs.${tab}`) }))} value={current} onChange={(tab) => setParams({ tab }, { replace: true })} />
          </div>
          {current === 'versions' && <VersionsCard workflow={data} canEdit={canEdit} />}
          {current === 'observers' && <ObserversCard workflowId={data.id} canEdit={canEdit} />}
        </div>
      </div>
      {editing && <EditWorkflowDialog workflow={data} onClose={() => setEditing(false)} />}
    </>
  );
}

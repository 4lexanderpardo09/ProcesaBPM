import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { workflowPath } from '@/shared/lib/paths';
import { useApiClient, usePermissions } from '@/shared/session';
import { Badge, Button, Checkbox, PageHeader, Pagination, PlusIcon, Table, type TableColumn, TextField } from '@/shared/ui';
import { WORKFLOWS_PAGE_SIZE, type WorkflowListItem, workflowsQueryOptions } from '../api/workflows-api';
import { NewWorkflowDialog } from '../components/NewWorkflowDialog';
import styles from '../components/Workflows.module.css';

const SEARCH_DELAY_MS = 300;

/** Every workflow with its subcategory and where its versions stand: published, being edited, or neither. */
export function WorkflowsPage() {
  const { t } = useTranslation('workflows');
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const settled = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const list = useQuery(workflowsQueryOptions(useApiClient(), { page, search: settled, includeInactive }));

  const columns: TableColumn<WorkflowListItem>[] = [
    {
      key: 'name',
      header: t('list.name'),
      cell: (row) => (
        <Link to={workflowPath(row.id)} className={styles.link}>
          {row.name}
        </Link>
      ),
    },
    { key: 'subcategory', header: t('list.subcategory'), cell: (row) => t('list.subcategoryPath', { category: row.subcategory.category.name, subcategory: row.subcategory.name }) },
    {
      key: 'published',
      header: t('list.published'),
      width: '150px',
      cell: (row) => (row.publishedVersion === null ? <Badge tone="warn">{t('list.notPublished')}</Badge> : <Badge tone="ok">{t('list.version', { number: row.publishedVersion.number })}</Badge>),
    },
    { key: 'draft', header: t('list.draft'), width: '100px', cell: (row) => (row.draftVersion === null ? t('list.none') : t('list.version', { number: row.draftVersion.number })) },
    { key: 'status', header: t('list.status'), width: '110px', cell: (row) => (row.isActive ? <Badge tone="ok">{t('list.active')}</Badge> : <Badge>{t('list.inactive')}</Badge>) },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          can('update', 'Workflow') ? (
            <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setCreating(true)}>
              {t('new')}
            </Button>
          ) : undefined
        }
      />
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <TextField
            label={t('list.search')}
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <Checkbox
          label={t('list.showInactive')}
          checked={includeInactive}
          onChange={(event) => {
            setIncludeInactive(event.target.checked);
            setPage(1);
          }}
        />
      </div>
      <Table
        label={t('list.label')}
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(row) => row.id}
        onRowClick={(row) => void navigate(workflowPath(row.id))}
        loading={list.data === undefined && !list.isError}
        loadingLabel={t('loading')}
        empty={list.isError ? t('loadFailed') : settled !== '' ? t('list.noMatches') : t('list.empty')}
        footer={list.data !== undefined && list.data.total > WORKFLOWS_PAGE_SIZE ? <Pagination page={page} pageSize={WORKFLOWS_PAGE_SIZE} total={list.data.total} onChange={setPage} /> : undefined}
      />
      {creating && <NewWorkflowDialog onClose={() => setCreating(false)} onCreated={(workflowId) => void navigate(workflowPath(workflowId))} />}
    </>
  );
}

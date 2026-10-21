import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { datasetPath, paths } from '@/shared/lib/paths';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { useApiClient, usePermissions } from '@/shared/session';
import { Badge, Breadcrumb, Button, Checkbox, PageHeader, Pagination, PlusIcon, Table, type TableColumn, TextField } from '@/shared/ui';
import { allWorkflowsQueryOptions } from '../../api/workflows-api';
import workflowStyles from '../../components/Workflows.module.css';
import { type Dataset, DATASETS_PAGE_SIZE, datasetsQueryOptions } from '../api/datasets-api';
import { LoadDatasetDialog } from '../components/LoadDatasetDialog';

const SEARCH_DELAY_MS = 300;

/** The Excel files loaded as the source of field values: how much each holds and which workflows may use it. */
export function DatasetsPage() {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const canEdit = usePermissions().can('update', 'Workflow');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const settled = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const list = useQuery(datasetsQueryOptions(client, { page, search: settled, includeInactive }));
  const workflowNames = new Map((useQuery(allWorkflowsQueryOptions(client)).data ?? []).map((workflow) => [workflow.id, workflow.name]));

  const columns: TableColumn<Dataset>[] = [
    {
      key: 'name',
      header: t('datasets.list.name'),
      cell: (row) => (
        <Link to={datasetPath(row.id)} className={workflowStyles.link}>
          {row.name}
        </Link>
      ),
    },
    { key: 'scope', header: t('datasets.list.scope'), cell: (row) => (row.workflowId === null ? t('datasets.allWorkflows') : (workflowNames.get(row.workflowId) ?? t('datasets.oneWorkflow'))) },
    { key: 'rows', header: t('datasets.list.rows'), width: '100px', cell: (row) => row.rowCount.toLocaleString('es-CO') },
    { key: 'loadedAt', header: t('datasets.list.loadedAt'), width: '170px', cell: (row) => formatDateTime(row.loadedAt) },
    { key: 'status', header: t('list.status'), width: '110px', cell: (row) => (row.isActive ? <Badge tone="ok">{t('list.active')}</Badge> : <Badge>{t('list.inactive')}</Badge>) },
  ];

  return (
    <>
      <Breadcrumb label={t('detail.breadcrumb')} items={[{ label: t('detail.back'), to: paths.workflows }, { label: t('datasets.title') }]} />
      <PageHeader
        title={t('datasets.title')}
        subtitle={t('datasets.subtitle')}
        actions={
          canEdit ? (
            <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setLoading(true)}>
              {t('datasets.new')}
            </Button>
          ) : undefined
        }
      />
      <div className={workflowStyles.toolbar}>
        <div className={workflowStyles.search}>
          <TextField
            label={t('datasets.list.search')}
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
        label={t('datasets.title')}
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(row) => row.id}
        onRowClick={(row) => void navigate(datasetPath(row.id))}
        loading={list.data === undefined && !list.isError}
        loadingLabel={t('loading')}
        empty={list.isError ? t('loadFailed') : settled !== '' ? t('datasets.list.noMatches') : t('datasets.list.empty')}
        footer={list.data !== undefined && list.data.total > DATASETS_PAGE_SIZE ? <Pagination page={page} pageSize={DATASETS_PAGE_SIZE} total={list.data.total} onChange={setPage} /> : undefined}
      />
      {loading && (
        <LoadDatasetDialog
          onClose={(loaded) => {
            setLoading(false);
            if (loaded !== undefined) void navigate(datasetPath(loaded.id));
          }}
        />
      )}
    </>
  );
}

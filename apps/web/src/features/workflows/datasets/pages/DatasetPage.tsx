import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '@/shared/api';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { paths } from '@/shared/lib/paths';
import { useApiClient, usePermissions } from '@/shared/session';
import { Alert, Breadcrumb, Button, Card, PageHeader, Pagination, Table, type TableColumn } from '@/shared/ui';
import { allWorkflowsQueryOptions } from '../../api/workflows-api';
import workflowStyles from '../../components/Workflows.module.css';
import { type Dataset, DATASET_ROWS_PAGE_SIZE, datasetQueryOptions, datasetRowsQueryOptions } from '../api/datasets-api';
import styles from '../components/Datasets.module.css';
import { DeleteDatasetDialog, EditDatasetDialog } from '../components/EditDatasetDialog';
import { LoadDatasetDialog } from '../components/LoadDatasetDialog';

const NOT_FOUND = 404;

type Dialog = 'edit' | 'reload' | 'delete';
interface Row {
  readonly position: number;
  readonly values: Readonly<Record<string, string>>;
}

/** One loaded Excel: what was loaded and when, its rows as stored (all text), and loading a new file over it. */
export function DatasetPage() {
  const { datasetId = '' } = useParams();
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const canEdit = usePermissions().can('update', 'Workflow');
  const navigate = useNavigate();
  const dataset = useQuery(datasetQueryOptions(client, datasetId));
  const [dialog, setDialog] = useState<Dialog>();

  const breadcrumb = (name: string) => (
    <Breadcrumb
      label={t('detail.breadcrumb')}
      items={[
        { label: t('detail.back'), to: paths.workflows },
        { label: t('datasets.title'), to: paths.datasets },
        { label: name },
      ]}
    />
  );
  if (dataset.isError) {
    return (
      <>
        {breadcrumb(t('datasets.title'))}
        <Alert tone="danger">{dataset.error instanceof ApiError && dataset.error.status === NOT_FOUND ? t('datasets.detail.notFound') : t('loadFailed')}</Alert>
      </>
    );
  }
  const data = dataset.data;
  if (data === undefined) return <p className={workflowStyles.note}>{t('loading')}</p>;

  return (
    <>
      {breadcrumb(data.name)}
      <PageHeader
        title={data.name}
        subtitle={t('datasets.detail.subtitle')}
        actions={
          canEdit ? (
            <div className={styles.headerActions}>
              <Button onClick={() => setDialog('edit')}>{t('datasets.detail.edit')}</Button>
              <Button onClick={() => setDialog('reload')}>{t('datasets.detail.reload')}</Button>
              <Button variant="ghost" onClick={() => setDialog('delete')}>
                {t('datasets.detail.delete')}
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className={workflowStyles.stack}>
        {!data.isActive && <Alert tone="warn">{t('datasets.detail.inactiveNotice')}</Alert>}
        <DatasetFacts dataset={data} />
        <DatasetRows key={data.loadedAt} dataset={data} />
      </div>
      {dialog === 'edit' && <EditDatasetDialog dataset={data} onClose={() => setDialog(undefined)} />}
      {dialog === 'reload' && <LoadDatasetDialog dataset={data} onClose={() => setDialog(undefined)} />}
      {dialog === 'delete' && <DeleteDatasetDialog dataset={data} onClose={() => setDialog(undefined)} onDeleted={() => void navigate(paths.datasets, { replace: true })} />}
    </>
  );
}

function DatasetFacts({ dataset }: { readonly dataset: Dataset }) {
  const { t } = useTranslation('workflows');
  const workflows = useQuery(allWorkflowsQueryOptions(useApiClient()));
  const scope = dataset.workflowId === null ? t('datasets.allWorkflows') : (workflows.data?.find((workflow) => workflow.id === dataset.workflowId)?.name ?? t('datasets.oneWorkflow'));
  const facts: readonly (readonly [string, string])[] = [
    [t('datasets.detail.file'), dataset.sourceFileName ?? t('list.none')],
    [t('datasets.detail.loadedAt'), formatDateTime(dataset.loadedAt)],
    [t('datasets.detail.size'), t('datasets.detail.sizeValue', { rows: dataset.rowCount.toLocaleString('es-CO'), columns: dataset.columns.length, count: dataset.rowCount })],
    [t('datasets.detail.key'), dataset.keyColumn ?? t('datasets.detail.noKey')],
    [t('datasets.list.scope'), scope],
  ];
  return (
    <Card title={t('datasets.detail.facts')}>
      <dl className={styles.facts}>
        {facts.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function DatasetRows({ dataset }: { readonly dataset: Dataset }) {
  const { t } = useTranslation('workflows');
  const [page, setPage] = useState(1);
  const rows = useQuery(datasetRowsQueryOptions(useApiClient(), dataset.id, page));
  const columns: TableColumn<Row>[] = [
    { key: '#', header: t('datasets.detail.position'), width: '64px', cell: (row) => row.position },
    ...dataset.columns.map((column) => ({
      key: column.name,
      header: column.isKey ? t('datasets.detail.keyHeader', { column: column.name }) : column.name,
      cell: (row: Row) => row.values[column.name] ?? '',
    })),
  ];
  // A row has no id of its own: its place among the loaded rows is stable until the next load.
  const offset = (page - 1) * DATASET_ROWS_PAGE_SIZE;
  const items: Row[] = (rows.data?.items ?? []).map((values, index) => ({ position: offset + index + 1, values }));
  return (
    <Card title={t('datasets.detail.rows')}>
      <Table
        label={t('datasets.detail.rowsLabel', { name: dataset.name })}
        columns={columns}
        rows={items}
        rowKey={(row) => String(row.position)}
        loading={rows.data === undefined && !rows.isError}
        loadingLabel={t('loading')}
        empty={rows.isError ? t('loadFailed') : t('datasets.detail.noRows')}
        footer={dataset.rowCount > DATASET_ROWS_PAGE_SIZE ? <Pagination page={page} pageSize={DATASET_ROWS_PAGE_SIZE} total={dataset.rowCount} onChange={setPage} /> : undefined}
      />
    </Card>
  );
}

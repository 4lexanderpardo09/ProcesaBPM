import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '@/shared/api';
import { exportPath, paths } from '@/shared/lib/paths';
import { useApiClient, usePermissions } from '@/shared/session';
import { Alert, Breadcrumb, Button, Dialog, PageHeader, Tabs } from '@/shared/ui';
import workflowStyles from '../../components/Workflows.module.css';
import { deleteExport, exportQueryKeys, exportQueryOptions } from '../api/exports-api';
import { ExportEditor } from '../components/ExportEditor';
import { ExportFilesTab } from '../components/ExportFilesTab';
import { ExportLinesTab } from '../components/ExportLinesTab';
import { ExportPreviewTab } from '../components/ExportPreviewTab';

const NOT_FOUND = 404;
const TABS = ['definition', 'files', 'lines', 'preview'] as const;
type ExportTab = (typeof TABS)[number];

/** A new export (`/workflows/exports/new`) or an existing one: its definition, files, pending lines and a preview row. */
export function ExportPage() {
  const { exportId } = useParams();
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const canEdit = can('update', 'Export');
  const isNew = exportId === undefined;
  const definition = useQuery({ ...exportQueryOptions(client, exportId ?? ''), enabled: !isNew });
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((tab) => tab !== 'preview' || canEdit);
  const current: ExportTab = tabs.find((tab) => tab === params.get('tab')) ?? 'definition';
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => deleteExport(client, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: exportQueryKeys.all });
      void navigate(paths.exports);
    },
  });

  const crumbs = (name: string) => <Breadcrumb label={t('detail.breadcrumb')} items={[{ label: t('detail.back'), to: paths.workflows }, { label: t('exports.breadcrumb'), to: paths.exports }, { label: name }]} />;
  if (isNew) {
    return (
      <>
        {crumbs(t('exports.new'))}
        <PageHeader title={t('exports.new')} />
        <ExportEditor definition={undefined} readOnly={!canEdit} onSaved={(saved) => void navigate(exportPath(saved.id), { replace: true })} />
      </>
    );
  }
  if (definition.isError) {
    return (
      <>
        {crumbs(t('exports.title'))}
        <Alert tone="danger">{definition.error instanceof ApiError && definition.error.status === NOT_FOUND ? t('exports.notFound') : t('exports.loadFailed')}</Alert>
      </>
    );
  }
  const data = definition.data;
  if (data === undefined) return <p className={workflowStyles.note}>{t('loading')}</p>;
  return (
    <>
      {crumbs(data.name)}
      <PageHeader
        title={data.name}
        subtitle={data.workflowName}
        actions={
          canEdit ? (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {t('exports.editor.delete')}
            </Button>
          ) : undefined
        }
      />
      <div className={workflowStyles.tabs}>
        <Tabs label={t('exports.title')} items={tabs.map((tab) => ({ value: tab, label: t(`exports.tabs.${tab}`) }))} value={current} onChange={(tab) => setParams({ tab }, { replace: true })} />
      </div>
      {current === 'definition' && <ExportEditor key={data.id} definition={data} readOnly={!canEdit} onSaved={() => undefined} />}
      {current === 'files' && <ExportFilesTab exportId={data.id} />}
      {current === 'lines' && <ExportLinesTab definition={data} />}
      {current === 'preview' && <ExportPreviewTab exportId={data.id} />}
      {confirming && (
        <Dialog
          open
          title={t('exports.editor.delete')}
          closeLabel={t('close')}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>{t('cancel')}</Button>
              <Button variant="brand" disabled={remove.isPending} onClick={() => remove.mutate(data.id)}>
                {t('exports.editor.delete')}
              </Button>
            </>
          }
        >
          <p>{t('exports.editor.deleteConfirm', { name: data.name })}</p>
        </Dialog>
      )}
    </>
  );
}

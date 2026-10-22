import type { PdfDesign, WorkflowVersionDocument } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker, useParams } from 'react-router';
import { ApiError } from '@/shared/api';
import { paths, workflowPath } from '@/shared/lib/paths';
import { useApiClient, usePermissions } from '@/shared/session';
import { Alert, Breadcrumb, Button, Dialog, PageHeader } from '@/shared/ui';
import { workflowQueryOptions } from '../../api/workflows-api';
import { versionDetailQueryOptions } from '../../builder/api/builder-api';
import { documentQueryKeys, type PdfFormat, pdfFormatQueryOptions, updatePdfFormat } from '../api/documents-api';
import { DocumentError } from '../components/DocumentError';
import { BandEditor } from '../components/designer/BandEditor';
import { FormatSettingsDialog } from '../components/designer/FormatSettingsDialog';
import { PageSettings } from '../components/designer/PageSettings';
import { PreviewPane } from '../components/designer/PreviewPane';
import { ProblemText } from '../components/designer/ProblemText';
import styles from '../components/designer/Designer.module.css';
import { BANDS, type BlockRef } from '../lib/design-doc';
import { designProblems } from '../lib/design-problems';

const NOT_FOUND = 404;
const EMPTY_DOCUMENT: WorkflowVersionDocument = { steps: [], transitions: [], fields: [], amountRules: [] };

/** The documents tab of the workflow, where formats are listed. */
const documentsTab = (workflowId: string) => `${workflowPath(workflowId)}?tab=documents`;

/**
 * The designer of a PDF format: page, header, body and footer as lists of blocks, checked as they change against the
 * version tickets run on (and the draft), saved as a whole, and drawn by the API with sample values beside them.
 */
export function PdfFormatPage() {
  const { workflowId = '', formatId = '' } = useParams();
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const workflow = useQuery(workflowQueryOptions(client, workflowId));
  const format = useQuery(pdfFormatQueryOptions(client, workflowId, formatId));
  const published = workflow.data?.versions.find((version) => version.status === 'PUBLISHED');
  const draft = workflow.data?.versions.find((version) => version.status === 'DRAFT');
  const publishedDoc = useQuery({ ...versionDetailQueryOptions(client, workflowId, published?.id ?? ''), enabled: published !== undefined });
  const draftDoc = useQuery({ ...versionDetailQueryOptions(client, workflowId, draft?.id ?? ''), enabled: draft !== undefined });

  const breadcrumb = (name: string) => (
    <Breadcrumb
      label={t('detail.breadcrumb')}
      items={[{ label: t('detail.back'), to: paths.workflows }, { label: workflow.data?.name ?? '…', to: documentsTab(workflowId) }, { label: name }]}
    />
  );
  if (format.isError || workflow.isError) {
    const missing = [format.error, workflow.error].some((error) => error instanceof ApiError && error.status === NOT_FOUND);
    return (
      <>
        {breadcrumb(t('documents.formats.title'))}
        <Alert tone="danger">{missing ? t('documents.designer.notFound') : t('loadFailed')}</Alert>
      </>
    );
  }
  const versionsReady = workflow.data !== undefined && (published === undefined || publishedDoc.data !== undefined) && (draft === undefined || draftDoc.data !== undefined);
  if (format.data === undefined || !versionsReady) return <p className={styles.note}>{t('loading')}</p>;
  // Tickets run on the published version; while there is none, the draft is all there is.
  const current = publishedDoc.data?.document ?? draftDoc.data?.document ?? EMPTY_DOCUMENT;
  const upcoming = publishedDoc.data === undefined ? undefined : draftDoc.data?.document;
  const loaded = format.data;
  if (loaded.design.version === 2) {
    return (
      <>
        {breadcrumb(loaded.name)}
        <Alert tone="info">{t('documents.designer.canvasSoon')}</Alert>
      </>
    );
  }
  return <Designer key={loaded.id} workflowId={workflowId} format={{ ...loaded, design: loaded.design }} current={current} upcoming={upcoming} breadcrumb={breadcrumb} />;
}

/** A format of the block designer (version 1). */
type BlockFormat = PdfFormat & { readonly design: PdfDesign };

interface DesignerProps {
  readonly workflowId: string;
  readonly format: BlockFormat;
  readonly current: WorkflowVersionDocument;
  readonly upcoming: WorkflowVersionDocument | undefined;
  readonly breadcrumb: (name: string) => ReactNode;
}

function Designer({ workflowId, format, current, upcoming, breadcrumb }: DesignerProps) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const canEdit = usePermissions().can('update', 'PdfDocument');
  const [saved, setSaved] = useState<PdfFormat>(format);
  const [design, setDesign] = useState<PdfDesign>(format.design);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<BlockRef>();
  const [settings, setSettings] = useState(false);
  const problems = designProblems(design, current, upcoming);
  const blocking = problems.filter((problem) => !problem.draftOnly);
  const edit = (next: PdfDesign) => {
    setDesign(next);
    setDirty(true);
  };
  const remember = (next: PdfFormat) => {
    setSaved(next);
    queryClient.setQueryData(documentQueryKeys.format(workflowId, next.id), next);
  };
  const save = useMutation({
    mutationFn: () => updatePdfFormat(client, workflowId, format.id, { design }),
    onSuccess: async (next) => {
      remember(next);
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: documentQueryKeys.formats(workflowId) });
    },
  });
  const canSave = canEdit && dirty && blocking.length === 0 && !save.isPending;

  // Ctrl/⌘+S saves from anywhere in the designer.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (canSave) save.mutate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canSave, save]);

  // Leaving with unsaved work asks first: in the app, and when the tab is closed or reloaded.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return (
    <>
      {breadcrumb(saved.name)}
      <PageHeader
        title={saved.name}
        subtitle={saved.description ?? t('documents.designer.subtitle')}
        actions={
          canEdit ? (
            <div className={styles.headerActions}>
              <span className={styles.saveState} role="status">
                {save.isPending ? t('saving') : dirty ? t('builder.dirty') : t('documents.designer.saved')}
              </span>
              <Button onClick={() => setSettings(true)}>{t('documents.designer.settings.open')}</Button>
              <Button variant="brand" disabled={!canSave} onClick={() => save.mutate()}>
                {t('save')}
              </Button>
            </div>
          ) : undefined
        }
      />
      {!saved.isActive && <Alert tone="warn">{t('documents.designer.inactive')}</Alert>}
      <div className={styles.layout}>
        <div className={styles.editor}>
          {blocking.length > 0 && <Alert tone="warn">{t('documents.designer.cannotSave', { count: blocking.length })}</Alert>}
          <DocumentError error={save.error} />
          {problems.some((problem) => problem.block === undefined) && (
            <ul className={styles.problems}>
              {problems
                .filter((problem) => problem.block === undefined)
                .map((problem, index) => (
                  <li key={index}>
                    <ProblemText problem={problem} />
                  </li>
                ))}
            </ul>
          )}
          <fieldset className={styles.unframed} disabled={!canEdit}>
            <PageSettings design={design} onChange={edit} />
            {BANDS.map((band) => (
              <BandEditor key={band} band={band} design={design} document={current} problems={problems} selected={selected} onSelect={setSelected} onChange={edit} />
            ))}
          </fieldset>
        </div>
        <PreviewPane workflowId={workflowId} formatId={format.id} savedAt={saved.updatedAt} dirty={dirty} />
      </div>
      {settings && <FormatSettingsDialog workflowId={workflowId} format={saved} document={current} onSaved={remember} onClose={() => setSettings(false)} />}
      {blocker.state === 'blocked' && (
        <Dialog
          open
          title={t('builder.dirty')}
          closeLabel={t('close')}
          onClose={() => blocker.reset()}
          footer={
            <>
              <Button onClick={() => blocker.reset()}>{t('cancel')}</Button>
              <Button variant="brand" onClick={() => blocker.proceed()}>
                {t('builder.leaveConfirm')}
              </Button>
            </>
          }
        >
          <p className={styles.note}>{t('documents.designer.leave')}</p>
        </Dialog>
      )}
    </>
  );
}

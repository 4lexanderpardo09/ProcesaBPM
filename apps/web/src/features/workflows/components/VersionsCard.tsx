import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatShortDate } from '@/shared/lib/format-date-time';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { Badge, type BadgeTone, Button, Card, Dialog, PlusIcon, Select, Table, type TableColumn, TextArea } from '@/shared/ui';
import { createVersion, deleteDraft, type VersionSummary, type WorkflowDetail, workflowQueryKeys } from '../api/workflows-api';
import { WorkflowError } from './WorkflowError';
import styles from './Workflows.module.css';

const STATUS_TONE: Readonly<Record<VersionSummary['status'], BadgeTone>> = { DRAFT: 'accent', PUBLISHED: 'ok', ARCHIVED: 'neutral' };
const NOTES_MAX = 2000;

/** The versions of a workflow, newest first; at most one draft and one published at a time. */
export function VersionsCard({ workflow, canEdit }: { readonly workflow: WorkflowDetail; readonly canEdit: boolean }) {
  const { t } = useTranslation('workflows');
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<VersionSummary | null>(null);
  const hasDraft = workflow.versions.some((version) => version.status === 'DRAFT');

  const columns: TableColumn<VersionSummary>[] = [
    { key: 'number', header: t('versions.version'), width: '90px', code: true, cell: (version) => t('list.version', { number: version.number }) },
    { key: 'status', header: t('versions.status'), width: '120px', cell: (version) => <Badge tone={STATUS_TONE[version.status]}>{t(`versions.statuses.${version.status}`)}</Badge> },
    { key: 'notes', header: t('versions.notes'), cell: (version) => version.notes ?? <span className={styles.secondary}>{t('list.none')}</span> },
    {
      key: 'date',
      header: t('versions.date'),
      width: '190px',
      cell: (version) =>
        version.publishedAt === null ? t('versions.createdOn', { date: formatShortDate(version.createdAt, timeZone) }) : t('versions.publishedOn', { date: formatShortDate(version.publishedAt, timeZone) }),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: '',
            width: '180px',
            cell: (version: VersionSummary) =>
              version.status === 'DRAFT' ? (
                <div className={styles.rowActions}>
                  <Button variant="ghost" aria-label={t('versions.deleteDraftNamed', { number: version.number })} onClick={() => setDeleting(version)}>
                    {t('versions.deleteDraft')}
                  </Button>
                </div>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <Card
      title={t('versions.title')}
      actions={
        canEdit && !hasDraft ? (
          <Button icon={<PlusIcon size={15} />} onClick={() => setCreating(true)}>
            {t('versions.newDraft')}
          </Button>
        ) : undefined
      }
    >
      <div className={styles.fields}>
        <p className={styles.note}>{t('versions.hint')}</p>
        <Table label={t('versions.label')} columns={columns} rows={workflow.versions} rowKey={(version) => version.id} empty={t('versions.empty')} />
      </div>
      {creating && <NewDraftDialog workflow={workflow} onClose={() => setCreating(false)} />}
      {deleting !== null && <DeleteDraftDialog workflowId={workflow.id} draft={deleting} onClose={() => setDeleting(null)} />}
    </Card>
  );
}

const EMPTY = 'empty';

function NewDraftDialog({ workflow, onClose }: { readonly workflow: WorkflowDetail; readonly onClose: () => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const sources = workflow.versions.filter((version) => version.status !== 'DRAFT');
  const published = sources.find((version) => version.status === 'PUBLISHED');
  const [from, setFrom] = useState((published ?? sources[0])?.id ?? EMPTY);
  const [notes, setNotes] = useState('');
  const create = useMutation({
    mutationFn: () => createVersion(client, workflow.id, { ...(from === EMPTY ? {} : { fromVersionId: from }), ...(notes.trim() === '' ? {} : { notes: notes.trim() }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workflowQueryKeys.all });
      onClose();
    },
  });
  const options = [
    ...sources.map((version) => ({ value: version.id, label: version.status === 'PUBLISHED' ? t('versions.fromPublished', { number: version.number }) : t('versions.fromVersion', { number: version.number }) })),
    { value: EMPTY, label: t('versions.fromEmpty') },
  ];
  return (
    <Dialog
      open
      title={t('versions.createTitle')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        if (!create.isPending) create.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="brand" disabled={create.isPending}>
            {create.isPending ? t('saving') : t('versions.create')}
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        <Select label={t('versions.from')} options={options} value={from} onChange={(event) => setFrom(event.target.value)} />
        <TextArea label={t('versions.notesLabel')} hint={t('versions.notesHint')} maxLength={NOTES_MAX} value={notes} onChange={(event) => setNotes(event.target.value)} />
        <WorkflowError error={create.error} context="createVersion" />
      </div>
    </Dialog>
  );
}

function DeleteDraftDialog({ workflowId, draft, onClose }: { readonly workflowId: string; readonly draft: VersionSummary; readonly onClose: () => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteDraft(client, workflowId, draft.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workflowQueryKeys.all });
      onClose();
    },
  });
  return (
    <Dialog
      open
      title={t('versions.deleteTitle')}
      closeLabel={t('close')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="brand" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? t('saving') : t('versions.deleteConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        <p className={styles.note}>{t('versions.deleteBody', { number: draft.number })}</p>
        <WorkflowError error={remove.error} context="deleteDraft" />
      </div>
    </Dialog>
  );
}

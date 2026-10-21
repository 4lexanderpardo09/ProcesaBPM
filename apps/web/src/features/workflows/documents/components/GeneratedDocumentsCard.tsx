import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { companiesQueryOptions } from '@/features/people';
import { useApiClient } from '@/shared/session';
import { Badge, Button, Card, Checkbox, Dialog, PlusIcon, Select, Table, type TableColumn } from '@/shared/ui';
import {
  createWorkflowDocument,
  deleteWorkflowDocument,
  type DocumentMoment,
  documentQueryKeys,
  pdfFormatsQueryOptions,
  pdfTemplatesQueryOptions,
  updateWorkflowDocument,
  type WorkflowDocument,
  workflowDocumentsQueryOptions,
} from '../api/documents-api';
import { DocumentError } from './DocumentError';
import styles from './Documents.module.css';

const MOMENTS: readonly (DocumentMoment | 'BLOCK')[] = ['CREATION', 'EACH_STEP', 'CLOSING', 'BLOCK'];
const ALL_COMPANIES = '';

export interface DocumentPermissions {
  readonly create: boolean;
  readonly update: boolean;
  readonly remove: boolean;
}

/** Which PDFs a ticket of this workflow gets, from which format or template, for which company and when. */
export function GeneratedDocumentsCard({ workflowId, can }: { readonly workflowId: string; readonly can: DocumentPermissions }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const documents = useQuery(workflowDocumentsQueryOptions(client, workflowId));
  const names = useSourceNames(workflowId);
  const companies = useQuery(companiesQueryOptions(client));
  const [editing, setEditing] = useState<WorkflowDocument | 'new'>();
  const remove = useMutation({
    mutationFn: (documentId: string) => deleteWorkflowDocument(client, workflowId, documentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: documentQueryKeys.documents(workflowId) }),
  });

  const companyName = (companyId: string | null) => (companyId === null ? t('documents.generated.allCompanies') : (companies.data?.find((company) => company.id === companyId)?.name ?? '…'));
  const sourceName = (document: WorkflowDocument) => names.get(document.formatId ?? document.templateId ?? '') ?? '…';
  const columns: TableColumn<WorkflowDocument>[] = [
    { key: 'source', header: t('documents.generated.source'), cell: (row) => sourceName(row) },
    { key: 'kind', header: t('documents.generated.kind'), width: '130px', cell: (row) => t(`documents.kinds.${row.kind}`) },
    { key: 'company', header: t('documents.generated.company'), cell: (row) => companyName(row.companyId) },
    { key: 'moment', header: t('documents.generated.moment'), cell: (row) => t(`documents.moments.${row.moment ?? 'BLOCK'}`) },
    { key: 'status', header: t('list.status'), width: '100px', cell: (row) => (row.isActive ? <Badge tone="ok">{t('list.active')}</Badge> : <Badge>{t('list.inactive')}</Badge>) },
  ];
  if (can.update || can.remove) {
    columns.push({
      key: 'actions',
      header: t('documents.actions'),
      width: '170px',
      cell: (row) => (
        <div className={styles.rowActions}>
          {can.update && (
            <Button variant="ghost" aria-label={t('documents.generated.editNamed', { name: sourceName(row) })} onClick={() => setEditing(row)}>
              {t('documents.edit')}
            </Button>
          )}
          {can.remove && (
            <Button variant="ghost" aria-label={t('documents.generated.removeNamed', { name: sourceName(row) })} disabled={remove.isPending} onClick={() => remove.mutate(row.id)}>
              {t('remove')}
            </Button>
          )}
        </div>
      ),
    });
  }

  return (
    <Card
      title={t('documents.generated.title')}
      actions={
        can.create ? (
          <Button icon={<PlusIcon size={15} />} onClick={() => setEditing('new')}>
            {t('documents.generated.add')}
          </Button>
        ) : undefined
      }
    >
      <div className={styles.stack}>
        <p className={styles.note}>{t('documents.generated.hint')}</p>
        <DocumentError error={remove.error} context="document" />
        <Table
          label={t('documents.generated.title')}
          columns={columns}
          rows={documents.data ?? []}
          rowKey={(row) => row.id}
          loading={documents.data === undefined && !documents.isError}
          loadingLabel={t('loading')}
          empty={documents.isError ? t('loadFailed') : t('documents.generated.empty')}
        />
      </div>
      {editing !== undefined && <WorkflowDocumentDialog workflowId={workflowId} document={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} />}
    </Card>
  );
}

/** Names of the workflow's formats and templates, by id. */
function useSourceNames(workflowId: string): ReadonlyMap<string, string> {
  const client = useApiClient();
  const formats = useQuery(pdfFormatsQueryOptions(client, workflowId));
  const templates = useQuery(pdfTemplatesQueryOptions(client, workflowId));
  return new Map([...(formats.data ?? []), ...(templates.data ?? [])].map((source) => [source.id, source.name]));
}

/** A new document (its source and company are fixed once made) or the moment and state of one. */
function WorkflowDocumentDialog({ workflowId, document, onClose }: { readonly workflowId: string; readonly document: WorkflowDocument | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const formats = useQuery(pdfFormatsQueryOptions(client, workflowId));
  const templates = useQuery(pdfTemplatesQueryOptions(client, workflowId));
  const companies = useQuery(companiesQueryOptions(client));
  const [source, setSource] = useState('');
  const [companyId, setCompanyId] = useState(ALL_COMPANIES);
  const [moment, setMoment] = useState<DocumentMoment | 'BLOCK'>(document?.moment ?? 'CREATION');
  const [isActive, setIsActive] = useState(document?.isActive ?? true);
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const chosenMoment = moment === 'BLOCK' ? null : moment;
      if (document !== undefined) return updateWorkflowDocument(client, workflowId, document.id, { moment: chosenMoment, isActive });
      const [kind, id] = source.split(':');
      return createWorkflowDocument(client, workflowId, {
        ...(kind === 'format' ? { formatId: id! } : { templateId: id! }),
        ...(companyId === ALL_COMPANIES ? {} : { companyId }),
        moment: chosenMoment,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentQueryKeys.documents(workflowId) });
      onClose();
    },
  });
  const sources = [
    ...(formats.data ?? []).filter((format) => format.isActive).map((format) => ({ value: `format:${format.id}`, label: t('documents.generated.formatOption', { name: format.name }) })),
    ...(templates.data ?? []).filter((template) => template.isActive).map((template) => ({ value: `template:${template.id}`, label: t('documents.generated.templateOption', { name: template.name }) })),
  ];
  const sourceError = submitted && document === undefined && source === '' ? t('documents.generated.pickSource') : undefined;

  return (
    <Dialog
      open
      title={document === undefined ? t('documents.generated.addTitle') : t('documents.generated.editTitle')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if ((document === undefined && source === '') || save.isPending) return;
        save.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="brand" disabled={save.isPending}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        {document === undefined && (
          <>
            {formats.data !== undefined && templates.data !== undefined && sources.length === 0 ? (
              <p className={styles.note}>{t('documents.generated.noSources')}</p>
            ) : (
              <Select label={t('documents.generated.source')} required error={sourceError} placeholder={t('documents.generated.sourcePlaceholder')} options={sources} value={source} onChange={(event) => setSource(event.target.value)} />
            )}
            <Select
              label={t('documents.generated.company')}
              hint={t('documents.generated.companyHint')}
              options={[{ value: ALL_COMPANIES, label: t('documents.generated.allCompanies') }, ...(companies.data ?? []).filter((company) => company.isActive).map((company) => ({ value: company.id, label: company.name }))]}
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
            />
          </>
        )}
        <Select
          label={t('documents.generated.moment')}
          hint={t(`documents.momentHints.${moment}`)}
          options={MOMENTS.map((value) => ({ value, label: t(`documents.moments.${value}`) }))}
          value={moment}
          onChange={(event) => setMoment(event.target.value as DocumentMoment | 'BLOCK')}
        />
        {document !== undefined && <Checkbox label={t('documents.activeLabel')} checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />}
        <DocumentError error={save.error} />
      </div>
    </Dialog>
  );
}

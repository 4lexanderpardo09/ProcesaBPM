import { MAX_FILE_BYTES, PDF_LIMITS } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { companiesQueryOptions } from '@/features/people';
import { uploadFiles } from '@/shared/files/upload-files';
import { formatFileSize } from '@/shared/lib/format-file-size';
import { useApiClient } from '@/shared/session';
import { Badge, Button, Card, Checkbox, Dialog, PlusIcon, Select, Table, type TableColumn, TextField } from '@/shared/ui';
import { deletePdfTemplate, documentQueryKeys, type PdfTemplate, pdfTemplatesQueryOptions, previewPdfTemplate, registerPdfTemplate, TEMPLATE_UPLOAD_ROUTES, updatePdfTemplate } from '../api/documents-api';
import { openPdf } from '../lib/open-pdf';
import { DocumentError } from './DocumentError';
import type { DocumentPermissions } from './GeneratedDocumentsCard';
import styles from './Documents.module.css';

const NAME_MAX = 200;
const PDF = '.pdf';
const ALL_COMPANIES = '';

/** PDFs the organization already has (a bank form, a contract) filled with the ticket's data. */
export function TemplatesCard({ workflowId, can }: { readonly workflowId: string; readonly can: DocumentPermissions }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const templates = useQuery(pdfTemplatesQueryOptions(client, workflowId));
  const companies = useQuery(companiesQueryOptions(client));
  const [dialog, setDialog] = useState<PdfTemplate | 'upload'>();
  const [blocked, setBlocked] = useState(false);
  const remove = useMutation({
    mutationFn: (templateId: string) => deletePdfTemplate(client, workflowId, templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: documentQueryKeys.templates(workflowId) }),
  });
  const preview = useMutation({
    mutationFn: (templateId: string) => openPdf(() => previewPdfTemplate(client, workflowId, templateId)),
    onSuccess: (opened) => setBlocked(!opened),
  });

  const companyName = (companyId: string | null) => (companyId === null ? t('documents.generated.allCompanies') : (companies.data?.find((company) => company.id === companyId)?.name ?? '…'));
  const columns: TableColumn<PdfTemplate>[] = [
    { key: 'name', header: t('documents.templates.name'), cell: (row) => row.name },
    { key: 'pages', header: t('documents.templates.pages'), width: '90px', cell: (row) => row.pageCount },
    { key: 'form', header: t('documents.templates.form'), width: '170px', cell: (row) => (row.hasAcroform ? t('documents.templates.formFields', { count: row.acroformFields.length }) : t('documents.templates.noForm')) },
    { key: 'company', header: t('documents.generated.company'), cell: (row) => companyName(row.companyId) },
    { key: 'status', header: t('list.status'), width: '100px', cell: (row) => (row.isActive ? <Badge tone="ok">{t('list.active')}</Badge> : <Badge>{t('list.inactive')}</Badge>) },
    {
      key: 'actions',
      header: t('documents.actions'),
      width: '250px',
      cell: (row) => (
        <div className={styles.rowActions}>
          <Button variant="ghost" aria-label={t('documents.templates.previewNamed', { name: row.name })} disabled={preview.isPending} onClick={() => preview.mutate(row.id)}>
            {t('documents.preview')}
          </Button>
          {can.update && (
            <Button variant="ghost" aria-label={t('documents.templates.editNamed', { name: row.name })} onClick={() => setDialog(row)}>
              {t('documents.edit')}
            </Button>
          )}
          {can.remove && (
            <Button variant="ghost" aria-label={t('documents.templates.removeNamed', { name: row.name })} disabled={remove.isPending} onClick={() => remove.mutate(row.id)}>
              {t('remove')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card
      title={t('documents.templates.title')}
      actions={
        can.create ? (
          <Button icon={<PlusIcon size={15} />} onClick={() => setDialog('upload')}>
            {t('documents.templates.upload')}
          </Button>
        ) : undefined
      }
    >
      <div className={styles.stack}>
        <p className={styles.note}>{t('documents.templates.hint')}</p>
        {blocked && <p className={styles.note}>{t('documents.popupBlocked')}</p>}
        <DocumentError error={remove.error ?? preview.error} context="source" />
        <Table
          label={t('documents.templates.title')}
          columns={columns}
          rows={templates.data ?? []}
          rowKey={(row) => row.id}
          loading={templates.data === undefined && !templates.isError}
          loadingLabel={t('loading')}
          empty={templates.isError ? t('loadFailed') : t('documents.templates.empty')}
        />
      </div>
      {dialog === 'upload' && <UploadTemplateDialog workflowId={workflowId} onClose={() => setDialog(undefined)} />}
      {dialog !== undefined && dialog !== 'upload' && <EditTemplateDialog workflowId={workflowId} template={dialog} onClose={() => setDialog(undefined)} />}
    </Card>
  );
}

/** Uploads the PDF (the API checks it is a real, unencrypted PDF of at most 50 pages) and registers it for one company or all. */
function UploadTemplateDialog({ workflowId, onClose }: { readonly workflowId: string; readonly onClose: () => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const companies = useQuery(companiesQueryOptions(client));
  const inputId = useId();
  const [file, setFile] = useState<File>();
  const [refusal, setRefusal] = useState<'notPdf' | 'tooBig'>();
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [companyId, setCompanyId] = useState(ALL_COMPANIES);
  const [submitted, setSubmitted] = useState(false);
  const upload = useMutation({
    mutationFn: async (chosen: File) => {
      const [uploaded] = await uploadFiles(client, [chosen], fetch, TEMPLATE_UPLOAD_ROUTES);
      return registerPdfTemplate(client, workflowId, { fileId: uploaded!.id, name: name.trim(), ...(companyId === ALL_COMPANIES ? {} : { companyId }) });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentQueryKeys.templates(workflowId) });
      onClose();
    },
  });
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    if (chosen === undefined) return;
    const problem = !chosen.name.toLowerCase().endsWith(PDF) ? 'notPdf' : chosen.size > MAX_FILE_BYTES ? 'tooBig' : undefined;
    setRefusal(problem);
    setFile(problem === undefined ? chosen : undefined);
    if (problem === undefined && !nameTouched) setName(chosen.name.slice(0, -PDF.length).slice(0, NAME_MAX));
    upload.reset();
  };
  const fileError = refusal === 'notPdf' ? t('documents.templates.notPdf') : refusal === 'tooBig' ? t('documents.templates.tooBig', { size: formatFileSize(MAX_FILE_BYTES) }) : submitted && file === undefined ? t('documents.templates.fileRequired') : undefined;
  const nameError = submitted && name.trim() === '' ? t('create.nameRequired') : undefined;

  return (
    <Dialog
      open
      title={t('documents.templates.uploadTitle')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (file === undefined || name.trim() === '' || upload.isPending) return;
        upload.mutate(file);
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="brand" disabled={upload.isPending}>
            {upload.isPending ? t('documents.templates.uploading') : t('documents.templates.uploadSubmit')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <div className={styles.file}>
          <label htmlFor={inputId} className="text-label">
            {t('documents.templates.file')}
            <span aria-hidden="true"> *</span>
          </label>
          <input id={inputId} type="file" accept={PDF} required aria-describedby={`${inputId}-hint`} aria-invalid={fileError !== undefined} disabled={upload.isPending} onChange={choose} />
          <span id={`${inputId}-hint`} className={styles.note}>
            {t('documents.templates.fileHint', { size: formatFileSize(MAX_FILE_BYTES), pages: PDF_LIMITS.maxTemplatePages })}
          </span>
          {fileError !== undefined && <span className={styles.error}>{fileError}</span>}
        </div>
        <TextField
          label={t('documents.templates.name')}
          required
          maxLength={NAME_MAX}
          error={nameError}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameTouched(true);
          }}
        />
        <Select
          label={t('documents.generated.company')}
          hint={t('documents.templates.companyHint')}
          options={[{ value: ALL_COMPANIES, label: t('documents.generated.allCompanies') }, ...(companies.data ?? []).filter((company) => company.isActive).map((company) => ({ value: company.id, label: company.name }))]}
          value={companyId}
          onChange={(event) => setCompanyId(event.target.value)}
        />
        <DocumentError error={upload.error} />
      </div>
    </Dialog>
  );
}

function EditTemplateDialog({ workflowId, template, onClose }: { readonly workflowId: string; readonly template: PdfTemplate; readonly onClose: () => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(template.name);
  const [isActive, setIsActive] = useState(template.isActive);
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: () => updatePdfTemplate(client, workflowId, template.id, { name: name.trim(), isActive }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentQueryKeys.templates(workflowId) });
      onClose();
    },
  });
  const nameError = submitted && name.trim() === '' ? t('create.nameRequired') : undefined;
  return (
    <Dialog
      open
      title={t('documents.templates.editTitle')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (name.trim() !== '' && !save.isPending) save.mutate();
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
        <TextField label={t('documents.templates.name')} required maxLength={NAME_MAX} error={nameError} value={name} onChange={(event) => setName(event.target.value)} />
        <Checkbox label={t('documents.activeLabel')} checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
        {!isActive && <p className={styles.note}>{t('documents.inactiveHint')}</p>}
        <DocumentError error={save.error} />
      </div>
    </Dialog>
  );
}

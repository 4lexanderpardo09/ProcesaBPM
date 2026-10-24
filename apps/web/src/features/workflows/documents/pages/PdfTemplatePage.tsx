import type { MappedField, MappedSignature, TemplateMapping, WorkflowVersionDocument } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker, useParams } from 'react-router';
import { ApiError } from '@/shared/api';
import { paths, workflowPath } from '@/shared/lib/paths';
import { useApiClient, usePermissions } from '@/shared/session';
import { Alert, Breadcrumb, Button, Dialog, PageHeader, PlusIcon } from '@/shared/ui';
import { documentQueryKeys, type PdfTemplate, pdfTemplateQueryOptions, previewPdfTemplate, saveTemplateMapping, templateFileUrl, templateMappingQueryOptions } from '../api/documents-api';
import { DocumentError } from '../components/DocumentError';
import { MappedFieldEditor, MappedSignatureEditor } from '../components/mapping/MappingItemEditor';
import { PageCanvas } from '../components/mapping/PageCanvas';
import styles from '../components/mapping/Mapping.module.css';
import { type ItemKind, type ItemRef, type MappingProblem, mappingProblems, newField, newSignature, placeAt, sameItem } from '../lib/mapping-doc';
import { openPdf } from '../lib/open-pdf';
import { loadPdf } from '@/shared/lib/pdf-pages';
import { useVersionDocuments } from '../lib/use-version-documents';

const NOT_FOUND = 404;
const documentsTab = (workflowId: string) => `${workflowPath(workflowId)}?tab=documents`;

/**
 * Where the ticket's data and signatures go on an uploaded PDF: by position (a click on the drawn page) or into the
 * form fields the PDF already has. Checked as it changes against the version tickets run on, and saved as a whole.
 */
export function PdfTemplatePage() {
  const { workflowId = '', templateId = '' } = useParams();
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const { workflow, ready, current, upcoming } = useVersionDocuments(workflowId);
  const template = useQuery(pdfTemplateQueryOptions(client, workflowId, templateId));
  const mapping = useQuery(templateMappingQueryOptions(client, workflowId, templateId));
  const pdf = useQuery({
    queryKey: ['pdf-template-file', workflowId, templateId],
    queryFn: async () => loadPdf((await templateFileUrl(client, workflowId, templateId)).url),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
  useEffect(() => () => pdf.data?.destroy(), [pdf.data]);

  const breadcrumb = (name: string) => (
    <Breadcrumb label={t('detail.breadcrumb')} items={[{ label: t('detail.back'), to: paths.workflows }, { label: workflow.data?.name ?? '…', to: documentsTab(workflowId) }, { label: name }]} />
  );
  const failures = [template.error, mapping.error, workflow.error];
  if (failures.some((error) => error !== null)) {
    const missing = failures.some((error) => error instanceof ApiError && error.status === NOT_FOUND);
    return (
      <>
        {breadcrumb(t('documents.templates.title'))}
        <Alert tone="danger">{missing ? t('documents.mapping.notFound') : t('loadFailed')}</Alert>
      </>
    );
  }
  if (template.data === undefined || mapping.data === undefined || !ready) return <p className={styles.note}>{t('loading')}</p>;
  return (
    <Mapper
      key={template.data.id}
      workflowId={workflowId}
      template={template.data}
      initial={mapping.data.mapping}
      current={current}
      upcoming={upcoming}
      pdf={pdf.data}
      pdfFailed={pdf.isError}
      breadcrumb={breadcrumb}
    />
  );
}

interface MapperProps {
  readonly workflowId: string;
  readonly template: PdfTemplate;
  readonly initial: TemplateMapping;
  readonly current: WorkflowVersionDocument;
  readonly upcoming: WorkflowVersionDocument | undefined;
  readonly pdf: Awaited<ReturnType<typeof loadPdf>> | undefined;
  readonly pdfFailed: boolean;
  readonly breadcrumb: (name: string) => ReactNode;
}

function Mapper({ workflowId, template, initial, current, upcoming, pdf, pdfFailed, breadcrumb }: MapperProps) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const canEdit = usePermissions().can('update', 'PdfDocument');
  const [mapping, setMapping] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<ItemRef>();
  const [placing, setPlacing] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [blocked, setBlocked] = useState(false);
  // Until the pages are drawn their sizes are unknown: positions are checked once they are.
  const problems: MappingProblem[] = pdf === undefined ? [] : mappingProblems(mapping, { pages: pdf.pages.map((page) => page.box), acroformFields: template.acroformFields }, current, upcoming);
  const blocking = problems.filter((problem) => !problem.draftOnly);
  const edit = (next: TemplateMapping) => {
    setMapping(next);
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: () => saveTemplateMapping(client, workflowId, template.id, mapping),
    onSuccess: (saved) => {
      queryClient.setQueryData(documentQueryKeys.mapping(workflowId, template.id), saved);
      setDirty(false);
    },
  });
  const preview = useMutation({ mutationFn: () => openPdf(() => previewPdfTemplate(client, workflowId, template.id)), onSuccess: (opened) => setBlocked(!opened) });
  const canSave = canEdit && dirty && pdf !== undefined && blocking.length === 0 && !save.isPending;

  const labelOf = (item: ItemRef) => {
    if (item.kind === 'signatures') {
      const slot = mapping.signatures[item.index];
      return t('documents.mapping.signatureLabel', { index: item.index + 1, step: slot?.stepName === '' || slot === undefined ? '…' : slot.stepName });
    }
    const field = mapping.fields[item.index];
    const name = field?.fieldCode !== undefined ? (current.fields.find((candidate) => candidate.code === field.fieldCode)?.label ?? field.fieldCode) : field?.expression;
    return t('documents.mapping.fieldLabel', { index: item.index + 1, name: name === undefined || name === '' ? '…' : name });
  };
  const replace = (item: ItemRef, next: MappedField | MappedSignature) =>
    edit(item.kind === 'fields' ? { ...mapping, fields: mapping.fields.map((field, index) => (index === item.index ? (next as MappedField) : field)) } : { ...mapping, signatures: mapping.signatures.map((slot, index) => (index === item.index ? (next as MappedSignature) : slot)) });
  const add = (kind: ItemKind) => {
    const index = mapping[kind].length;
    edit(kind === 'fields' ? { ...mapping, fields: [...mapping.fields, newField()] } : { ...mapping, signatures: [...mapping.signatures, newSignature()] });
    setSelected({ kind, index });
    setPlacing(true);
  };
  const remove = (item: ItemRef) => {
    edit({ ...mapping, [item.kind]: mapping[item.kind].filter((_entry, index) => index !== item.index) });
    setSelected(undefined);
    setPlacing(false);
  };
  const place = (page: number, x: number, y: number) => {
    if (selected === undefined) return;
    const item = mapping[selected.kind][selected.index];
    if (item !== undefined) replace(selected, placeAt(item, page, x, y));
    setPlacing(false);
  };

  // Leaving with unsaved work asks first: in the app, and when the tab is closed or reloaded.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const list = (kind: ItemKind) => (
    <section className={styles.panel} aria-labelledby={`mapping-${kind}`}>
      <header className={styles.panelHeader}>
        <h2 id={`mapping-${kind}`} className={styles.title}>
          {t(`documents.mapping.${kind}`)}
        </h2>
        {canEdit && (
          <Button icon={<PlusIcon size={14} />} onClick={() => add(kind)}>
            {t(`documents.mapping.add.${kind}`)}
          </Button>
        )}
      </header>
      {mapping[kind].length === 0 ? (
        <p className={styles.note}>{t(`documents.mapping.empty.${kind}`)}</p>
      ) : (
        <ol className={styles.items}>
          {mapping[kind].map((entry, index) => {
            const ref = { kind, index };
            const open = sameItem(ref, selected);
            const own = problems.filter((problem) => sameItem(problem.item, ref));
            return (
              <li key={index} className={styles.item} data-open={open || undefined} data-problem={own.some((problem) => !problem.draftOnly) || undefined}>
                <div className={styles.itemHead}>
                  <button
                    type="button"
                    className={styles.itemToggle}
                    aria-expanded={open}
                    onClick={() => {
                      setSelected(open ? undefined : ref);
                      setPlacing(false);
                      if (!open && entry.mode === 'COORDINATES' && entry.page !== undefined && pdf !== undefined && entry.page <= pdf.pages.length) setPageNumber(entry.page);
                    }}
                  >
                    {labelOf(ref)}
                    {own.length > 0 && <span className={styles.badge}>{t('documents.designer.problemCount', { count: own.length })}</span>}
                  </button>
                  {canEdit && (
                    <Button variant="ghost" aria-label={t('documents.mapping.remove', { item: labelOf(ref) })} onClick={() => remove(ref)}>
                      ×
                    </Button>
                  )}
                </div>
                {open && (
                  <fieldset className={styles.itemBody} disabled={!canEdit} aria-label={t('documents.designer.blockSettings', { block: labelOf(ref) })}>
                    {own.length > 0 && (
                      <ul className={styles.problems}>
                        {own.map((problem, at) => (
                          <li key={at} data-draft={problem.draftOnly || undefined}>
                            {problem.draftOnly ? t('documents.designer.problems.draftOnly', { text: t(`documents.mapping.problems.${problem.code}`, { detail: problem.detail }) }) : t(`documents.mapping.problems.${problem.code}`, { detail: problem.detail })}
                          </li>
                        ))}
                      </ul>
                    )}
                    {kind === 'fields' ? (
                      <MappedFieldEditor field={entry as MappedField} document={current} acroformFields={template.acroformFields} placing={placing} onPlace={() => setPlacing((now) => !now)} onChange={(next) => replace(ref, next)} />
                    ) : (
                      <MappedSignatureEditor slot={entry as MappedSignature} document={current} acroformFields={template.acroformFields} placing={placing} onPlace={() => setPlacing((now) => !now)} onChange={(next) => replace(ref, next)} />
                    )}
                  </fieldset>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );

  return (
    <>
      {breadcrumb(template.name)}
      <PageHeader
        title={template.name}
        subtitle={t('documents.mapping.subtitle')}
        actions={
          <div className={styles.headerActions}>
            {canEdit && (
              <span className={styles.saveState} role="status">
                {save.isPending ? t('saving') : dirty ? t('builder.dirty') : t('documents.designer.saved')}
              </span>
            )}
            <Button disabled={preview.isPending} onClick={() => preview.mutate()}>
              {t('documents.preview')}
            </Button>
            {canEdit && (
              <Button variant="brand" disabled={!canSave} onClick={() => save.mutate()}>
                {t('save')}
              </Button>
            )}
          </div>
        }
      />
      {blocked && <Alert tone="warn">{t('documents.popupBlocked')}</Alert>}
      {dirty && <p className={styles.note}>{t('documents.mapping.previewSaved')}</p>}
      {blocking.length > 0 && <Alert tone="warn">{t('documents.designer.cannotSave', { count: blocking.length })}</Alert>}
      <DocumentError error={save.error ?? preview.error} />
      <div className={styles.layout}>
        <div className={styles.side}>
          {list('fields')}
          {list('signatures')}
        </div>
        {pdf !== undefined ? (
          <PageCanvas pdf={pdf} mapping={mapping} selected={selected} placing={placing} labelOf={labelOf} onSelect={setSelected} onPlace={place} pageNumber={pageNumber} onPageChange={setPageNumber} />
        ) : (
          <p className={styles.note}>{pdfFailed ? t('documents.mapping.fileFailed') : t('documents.mapping.loadingFile')}</p>
        )}
      </div>
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
          <p className={styles.note}>{t('documents.mapping.leave')}</p>
        </Dialog>
      )}
    </>
  );
}

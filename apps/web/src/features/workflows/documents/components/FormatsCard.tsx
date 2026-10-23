import { emptyCanvasDesign, emptyDesign } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { pdfFormatPath } from '@/shared/lib/paths';
import { useApiClient } from '@/shared/session';
import { Badge, Button, Card, Dialog, PlusIcon, Select, Table, type TableColumn, TextField } from '@/shared/ui';
import { createPdfFormat, deletePdfFormat, documentQueryKeys, type PdfFormat, pdfFormatsQueryOptions } from '../api/documents-api';
import { DocumentError } from './DocumentError';
import type { DocumentPermissions } from './GeneratedDocumentsCard';
import styles from './Documents.module.css';

const NAME_MAX = 200;

/** Formats drawn by the designer: blocks of text, data, tables and signatures laid out on the page. */
export function FormatsCard({ workflowId, can }: { readonly workflowId: string; readonly can: DocumentPermissions }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const formats = useQuery(pdfFormatsQueryOptions(client, workflowId));
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState<PdfFormat>();
  const remove = useMutation({
    mutationFn: (formatId: string) => deletePdfFormat(client, workflowId, formatId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: documentQueryKeys.formats(workflowId) }),
  });

  const columns: TableColumn<PdfFormat>[] = [
    {
      key: 'name',
      header: t('documents.formats.name'),
      cell: (row) => (
        <Link to={pdfFormatPath(workflowId, row.id)} className={styles.link}>
          {row.name}
        </Link>
      ),
    },
    { key: 'warnings', header: t('documents.formats.check'), width: '150px', cell: (row) => (row.warnings.length === 0 ? <Badge tone="ok">{t('documents.formats.ok')}</Badge> : <Badge tone="warn">{t('documents.formats.problems', { count: row.warnings.length })}</Badge>) },
    { key: 'updatedAt', header: t('documents.formats.updatedAt'), width: '180px', cell: (row) => formatDateTime(row.updatedAt) },
    { key: 'status', header: t('list.status'), width: '100px', cell: (row) => (row.isActive ? <Badge tone="ok">{t('list.active')}</Badge> : <Badge>{t('list.inactive')}</Badge>) },
  ];
  if (can.create || can.remove) {
    columns.push({
      key: 'actions',
      header: t('documents.actions'),
      width: '190px',
      cell: (row) => (
        // The row opens the format: its buttons do their own thing.
        <div className={styles.rowActions} onClick={(event) => event.stopPropagation()}>
          {can.create && (
            <Button variant="ghost" aria-label={t('documents.formats.duplicateNamed', { name: row.name })} onClick={() => setCopying(row)}>
              {t('documents.formats.duplicate')}
            </Button>
          )}
          {can.remove && (
            <Button variant="ghost" aria-label={t('documents.formats.removeNamed', { name: row.name })} disabled={remove.isPending} onClick={() => remove.mutate(row.id)}>
              {t('remove')}
            </Button>
          )}
        </div>
      ),
    });
  }

  return (
    <Card
      title={t('documents.formats.title')}
      actions={
        can.create ? (
          <Button icon={<PlusIcon size={15} />} onClick={() => setCreating(true)}>
            {t('documents.formats.new')}
          </Button>
        ) : undefined
      }
    >
      <div className={styles.stack}>
        <p className={styles.note}>{t('documents.formats.hint')}</p>
        <DocumentError error={remove.error} context="source" />
        <Table
          label={t('documents.formats.title')}
          columns={columns}
          rows={formats.data ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => void navigate(pdfFormatPath(workflowId, row.id))}
          loading={formats.data === undefined && !formats.isError}
          loadingLabel={t('loading')}
          empty={formats.isError ? t('loadFailed') : t('documents.formats.empty')}
        />
      </div>
      {creating && <NewFormatDialog workflowId={workflowId} onClose={() => setCreating(false)} onCreated={(formatId) => void navigate(pdfFormatPath(workflowId, formatId))} />}
      {copying !== undefined && <NewFormatDialog workflowId={workflowId} source={copying} onClose={() => setCopying(undefined)} onCreated={(formatId) => void navigate(pdfFormatPath(workflowId, formatId))} />}
    </Card>
  );
}

interface NewFormatDialogProps {
  readonly workflowId: string;
  /** The format to copy (its design, description and file name), or none to start from scratch. */
  readonly source?: PdfFormat;
  readonly onClose: () => void;
  readonly onCreated: (formatId: string) => void;
}

/** A format starts as a free canvas with the ticket's title and number, as blocks with every field of the ticket, or as a copy of another one. */
function NewFormatDialog({ workflowId, source, onClose, onCreated }: NewFormatDialogProps) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(source === undefined ? '' : t('documents.formats.copyName', { name: source.name }).slice(0, NAME_MAX));
  const [kind, setKind] = useState<'CANVAS' | 'BLOCKS'>('CANVAS');
  const [submitted, setSubmitted] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      createPdfFormat(
        client,
        workflowId,
        source === undefined
          ? { name: name.trim(), design: kind === 'CANVAS' ? emptyCanvasDesign() : emptyDesign() }
          : { name: name.trim(), design: source.design, ...(source.description === null ? {} : { description: source.description }), ...(source.fileNamePattern === null ? {} : { fileNamePattern: source.fileNamePattern }) },
      ),
    onSuccess: async (format) => {
      queryClient.setQueryData(documentQueryKeys.format(workflowId, format.id), format);
      await queryClient.invalidateQueries({ queryKey: documentQueryKeys.formats(workflowId) });
      onCreated(format.id);
    },
  });
  const nameError = submitted && name.trim() === '' ? t('create.nameRequired') : undefined;
  return (
    <Dialog
      open
      title={source === undefined ? t('documents.formats.newTitle') : t('documents.formats.duplicateTitle', { name: source.name })}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (name.trim() !== '' && !create.isPending) create.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="brand" disabled={create.isPending}>
            {create.isPending ? t('saving') : t('documents.formats.create')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <TextField label={t('documents.formats.name')} required maxLength={NAME_MAX} error={nameError} value={name} onChange={(event) => setName(event.target.value)} />
        {source === undefined ? (
          <>
            <Select label={t('documents.formats.kind')} options={(['CANVAS', 'BLOCKS'] as const).map((value) => ({ value, label: t(`documents.formats.kinds.${value}`) }))} value={kind} onChange={(event) => setKind(event.target.value as 'CANVAS' | 'BLOCKS')} />
            <p className={styles.note}>{kind === 'CANVAS' ? t('documents.formats.canvasHint') : t('documents.formats.newHint')}</p>
          </>
        ) : (
          <p className={styles.note}>{t('documents.formats.duplicateHint')}</p>
        )}
        <DocumentError error={create.error} />
      </div>
    </Dialog>
  );
}

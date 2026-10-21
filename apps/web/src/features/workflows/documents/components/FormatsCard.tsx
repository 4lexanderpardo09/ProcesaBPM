import { emptyDesign } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { pdfFormatPath } from '@/shared/lib/paths';
import { useApiClient } from '@/shared/session';
import { Badge, Button, Card, Dialog, PlusIcon, Table, type TableColumn, TextField } from '@/shared/ui';
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
  if (can.remove) {
    columns.push({
      key: 'actions',
      header: t('documents.actions'),
      width: '100px',
      cell: (row) => (
        <Button variant="ghost" aria-label={t('documents.formats.removeNamed', { name: row.name })} disabled={remove.isPending} onClick={() => remove.mutate(row.id)}>
          {t('remove')}
        </Button>
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
    </Card>
  );
}

/** A format starts as a title and every field of the ticket; the designer shapes it from there. */
function NewFormatDialog({ workflowId, onClose, onCreated }: { readonly workflowId: string; readonly onClose: () => void; readonly onCreated: (formatId: string) => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const create = useMutation({
    mutationFn: () => createPdfFormat(client, workflowId, { name: name.trim(), design: emptyDesign() }),
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
      title={t('documents.formats.newTitle')}
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
        <p className={styles.note}>{t('documents.formats.newHint')}</p>
        <DocumentError error={create.error} />
      </div>
    </Dialog>
  );
}

import type { WorkflowVersionDocument } from '@procesabpm/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Button, Checkbox, Dialog, TextArea, TextField } from '@/shared/ui';
import { documentQueryKeys, type PdfFormat, updatePdfFormat } from '../../api/documents-api';
import { DocumentError } from '../DocumentError';
import { ExpressionField } from './ExpressionField';
import styles from './Designer.module.css';

const NAME_MAX = 200;

/** What the format is called, its note, the name of the files it makes and whether it is in use; saved on its own. */
export function FormatSettingsDialog({ workflowId, format, document, onSaved, onClose }: { readonly workflowId: string; readonly format: PdfFormat; readonly document: WorkflowVersionDocument; readonly onSaved: (format: PdfFormat) => void; readonly onClose: () => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(format.name);
  const [description, setDescription] = useState(format.description ?? '');
  const [fileNamePattern, setFileNamePattern] = useState(format.fileNamePattern ?? '');
  const [isActive, setIsActive] = useState(format.isActive);
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      updatePdfFormat(client, workflowId, format.id, {
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        fileNamePattern: fileNamePattern.trim() === '' ? null : fileNamePattern.trim(),
        isActive,
      }),
    onSuccess: async (saved) => {
      onSaved(saved);
      await queryClient.invalidateQueries({ queryKey: documentQueryKeys.formats(workflowId) });
      onClose();
    },
  });
  const nameError = submitted && name.trim() === '' ? t('create.nameRequired') : undefined;
  return (
    <Dialog
      open
      title={t('documents.designer.settings.title')}
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
      <div className={styles.blockForm}>
        <TextField label={t('documents.formats.name')} required maxLength={NAME_MAX} error={nameError} value={name} onChange={(event) => setName(event.target.value)} />
        <TextArea label={t('documents.designer.settings.description')} maxLength={1000} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
        <ExpressionField label={t('documents.designer.settings.fileName')} value={fileNamePattern} onChange={setFileNamePattern} document={document} inBand={false} />
        <p className={styles.note}>{t('documents.designer.settings.fileNameHint')}</p>
        <Checkbox label={t('documents.activeLabel')} checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
        {!isActive && <p className={styles.note}>{t('documents.inactiveHint')}</p>}
        <DocumentError error={save.error} />
      </div>
    </Dialog>
  );
}

import type { ReplaceStepFilesRequest, StepFileDocument } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadFiles } from '@/shared/files/upload-files';
import { useApiClient } from '@/shared/session';
import { Alert, Button, TextField } from '@/shared/ui';
import styles from '../Builder.module.css';

type StepFile = ReplaceStepFilesRequest['files'][number];

/** Formats or guides the person taking the step can download: uploaded here, named, in order. */
export function StepFilesEditor({ files, readOnly, pending, onChange }: { readonly files: readonly StepFileDocument[]; readonly readOnly: boolean; readonly pending: boolean; readonly onChange: (files: StepFile[]) => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const current: StepFile[] = [...files].sort((a, b) => a.sortOrder - b.sortOrder).map((file, index) => ({ fileId: file.fileId, label: file.label, sortOrder: index }));
  const upload = useMutation({
    mutationFn: async (file: File) => (await uploadFiles(client, [file]))[0],
    onSuccess: (stored) => {
      if (stored === undefined) return;
      onChange([...current, { fileId: stored.id, label: label.trim() === '' ? stored.name : label.trim(), sortOrder: current.length }]);
      setLabel('');
    },
  });
  return (
    <div className={styles.participants}>
      {current.length === 0 ? (
        <p className={styles.note}>{t('builder.participants.filesEmpty')}</p>
      ) : (
        <ul className={styles.fieldList} aria-label={t('builder.participants.files')}>
          {current.map((file) => (
            <li key={file.fileId} className={styles.fieldRow}>
              <span className={styles.fieldName}>{file.label}</span>
              {!readOnly && (
                <Button variant="ghost" aria-label={t('builder.participants.removeNamed', { name: file.label })} disabled={pending} onClick={() => onChange(current.filter((other) => other.fileId !== file.fileId).map((other, index) => ({ ...other, sortOrder: index })))}>
                  {t('builder.participants.remove')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className={styles.addParticipant}>
          <TextField label={t('builder.participants.fileLabel')} maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} />
          <input
            ref={input}
            type="file"
            className={styles.visuallyHidden}
            aria-label={t('builder.participants.chooseFile')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) upload.mutate(file);
              event.target.value = '';
            }}
          />
          <div>
            <Button disabled={upload.isPending || pending} onClick={() => input.current?.click()}>
              {upload.isPending ? t('builder.participants.uploading') : t('builder.participants.chooseFile')}
            </Button>
          </div>
          {upload.isError && <Alert tone="danger">{t('builder.participants.uploadFailed')}</Alert>}
        </div>
      )}
    </div>
  );
}

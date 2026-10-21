import { ALLOWED_FILE_TYPES, allowedTypeOf, type FileKind, type FormFieldResponse, MAX_FILE_BYTES } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { type ChangeEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadFiles, type UploadedFile } from '@/shared/files/upload-files';
import { formatFileSize } from '@/shared/lib/format-file-size';
import { useApiClient } from '@/shared/session';
import { Button } from '@/shared/ui';
import styles from './AdvanceDialog.module.css';

export interface FileInputProps {
  readonly field: FormFieldResponse;
  /** Ids of confirmed files. */
  readonly value: readonly string[];
  /** Names of the files the ticket already has, by id. */
  readonly knownNames: Readonly<Record<string, string>>;
  readonly error: string | undefined;
  readonly onChange: (value: readonly string[]) => void;
  /** While a file is on its way the step cannot be sent: its id does not exist yet. */
  readonly onBusyChange: (busy: boolean) => void;
}

const ALL_KINDS: readonly FileKind[] = ['PDF', 'IMAGE', 'OFFICE', 'ZIP'];

type Refusal = { readonly key: 'tooMany'; readonly count: number } | { readonly key: 'notAllowed' | 'tooBig'; readonly name: string };

/**
 * A FILE field: files are uploaded as soon as they are chosen (declared, sent to storage, confirmed) and the field keeps
 * their ids. What the browser can tell beforehand (type, size, how many) is checked here; the API checks the content.
 */
export function FileInput({ field, value, knownNames, error, onChange, onBusyChange }: FileInputProps) {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const inputId = useId();
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [refusal, setRefusal] = useState<Refusal>();
  const kinds = acceptedKinds(field);
  const maxFiles = typeof field.config['maxFiles'] === 'number' ? field.config['maxFiles'] : 1;
  const upload = useMutation({
    mutationFn: (files: readonly File[]) => uploadFiles(client, files),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: (uploaded: readonly UploadedFile[]) => {
      setNames((current) => ({ ...current, ...Object.fromEntries(uploaded.map((file) => [file.id, file.name])) }));
      onChange([...value, ...uploaded.map((file) => file.id)]);
    },
  });

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    const problem = refusalOf(files, kinds, maxFiles - value.length);
    setRefusal(problem);
    if (problem === undefined) upload.mutate(files);
  };
  const nameOf = (id: string) => names[id] ?? knownNames[id] ?? t('advance.files.current');
  const message = refusal === undefined ? undefined : refusal.key === 'tooMany' ? t('advance.files.tooMany', { count: refusal.count }) : refusal.key === 'tooBig' ? t('advance.files.tooBig', { name: refusal.name, size: formatFileSize(MAX_FILE_BYTES) }) : t('advance.files.notAllowed', { name: refusal.name });

  return (
    <fieldset className={styles.choices} aria-invalid={error !== undefined}>
      <legend className="text-label">
        {field.label}
        {field.isRequired && <span aria-hidden="true"> *</span>}
      </legend>
      {value.length === 0 ? (
        <p className={styles.pendingNote}>{t('advance.files.none')}</p>
      ) : (
        <ul className={styles.chosen} aria-label={t('advance.files.list', { field: field.label })}>
          {value.map((id) => (
            <li key={id} className={styles.chip}>
              <span>{nameOf(id)}</span>
              <Button variant="ghost" aria-label={t('advance.choices.remove', { value: nameOf(id) })} onClick={() => onChange(value.filter((current) => current !== id))}>
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      {value.length < maxFiles && (
        <div className={styles.pending}>
          <label htmlFor={inputId} className="text-label">
            {t('advance.files.add', { count: maxFiles })}
          </label>
          <input id={inputId} type="file" multiple={maxFiles - value.length > 1} accept={acceptOf(kinds)} disabled={upload.isPending} onChange={choose} />
          <span className={styles.pendingNote}>{upload.isPending ? t('advance.files.uploading') : t('advance.files.hint', { size: formatFileSize(MAX_FILE_BYTES) })}</span>
        </div>
      )}
      {message !== undefined && <span className={styles.pendingError}>{message}</span>}
      {upload.isError && <span className={styles.pendingError}>{t('advance.files.failed')}</span>}
      {error !== undefined && <span className={styles.pendingError}>{error}</span>}
    </fieldset>
  );
}

function acceptedKinds(field: FormFieldResponse): readonly FileKind[] {
  const accept = field.config['accept'];
  return Array.isArray(accept) && accept.length > 0 ? (accept as readonly FileKind[]) : ALL_KINDS;
}

/** The extensions of the accepted kinds, for the browser's file picker (a hint: the API decides by extension and content). */
function acceptOf(kinds: readonly FileKind[]): string {
  return Object.entries(ALLOWED_FILE_TYPES)
    .filter(([, type]) => kinds.includes(type.kind))
    .map(([extension]) => `.${extension}`)
    .join(',');
}

function refusalOf(files: readonly File[], kinds: readonly FileKind[], room: number): Refusal | undefined {
  if (files.length > room) return { key: 'tooMany', count: room };
  for (const file of files) {
    const type = allowedTypeOf(file.name);
    if (type === undefined || !kinds.includes(type.kind)) return { key: 'notAllowed', name: file.name };
    if (file.size > MAX_FILE_BYTES) return { key: 'tooBig', name: file.name };
  }
  return undefined;
}

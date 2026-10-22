import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PDF_IMAGE_MAX_BYTES, PDF_IMAGE_TYPES } from '@/shared/organization/logo-api';
import { useApiClient } from '@/shared/session';
import { Alert, Button } from '@/shared/ui';
import { deletePdfImage, documentQueryKeys, uploadPdfImage } from '../../api/documents-api';
import { DocumentError } from '../../components/DocumentError';
import { useCanvasImages } from '../lib/canvas-images';
import styles from './Canvas.module.css';

export interface ImagePickerProps {
  readonly selected: string | undefined;
  readonly onPick: (imageId: string) => void;
}

/** The workflow's images to choose from, uploading a new one (which is chosen at once) or deleting one no format shows. */
export function ImagePicker({ selected, onPick }: ImagePickerProps) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { workflowId, images } = useCanvasImages();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<'type' | 'size'>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: documentQueryKeys.images(workflowId) });
  const upload = useMutation({
    mutationFn: (file: File) => uploadPdfImage(client, workflowId, file),
    onSuccess: async (image) => {
      await refresh();
      onPick(image.id);
    },
  });
  const remove = useMutation({ mutationFn: (imageId: string) => deletePdfImage(client, workflowId, imageId), onSuccess: refresh });

  return (
    <div className={styles.form}>
      {images === undefined ? (
        <p className={styles.note}>{t('documents.canvas.images.loading')}</p>
      ) : images.length === 0 ? (
        <p className={styles.note}>{t('documents.canvas.images.none')}</p>
      ) : (
        <ul className={styles.imageGrid} aria-label={t('documents.canvas.images.label')}>
          {images.map((image) => (
            <li key={image.id} className={styles.imageItem}>
              <button type="button" className={styles.imageChoice} aria-pressed={image.id === selected} title={image.name} onClick={() => onPick(image.id)}>
                <img src={image.url} alt={image.name} />
              </button>
              {image.id !== selected && (
                <button type="button" className={styles.linkButton} disabled={remove.isPending} aria-label={t('documents.canvas.images.deleteNamed', { name: image.name })} onClick={() => remove.mutate(image.id)}>
                  {t('documents.canvas.images.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {problem !== undefined && <Alert tone="danger">{t(problem === 'type' ? 'documents.canvas.images.wrongType' : 'documents.canvas.images.tooLarge')}</Alert>}
      <DocumentError error={upload.error ?? remove.error} />
      <input
        ref={input}
        type="file"
        accept={PDF_IMAGE_TYPES.join(',')}
        hidden
        aria-label={t('documents.canvas.images.file')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) return;
          setProblem(undefined);
          if (!PDF_IMAGE_TYPES.includes(file.type)) setProblem('type');
          else if (file.size > PDF_IMAGE_MAX_BYTES) setProblem('size');
          else upload.mutate(file);
        }}
      />
      <Button disabled={upload.isPending} onClick={() => input.current?.click()}>
        {upload.isPending ? t('documents.canvas.images.uploading') : t('documents.canvas.images.upload')}
      </Button>
    </div>
  );
}

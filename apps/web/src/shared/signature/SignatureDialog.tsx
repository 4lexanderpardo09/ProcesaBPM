import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadFiles } from '@/shared/files/upload-files';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Dialog, SignaturePad, type SignaturePadHandle } from '@/shared/ui';
import styles from './SignatureDialog.module.css';

const ACCEPTED = ['image/png', 'image/jpeg'];
/** What a PDF draws: a heavier image would be left out of the documents. */
const MAX_BYTES = 1024 * 1024;

export interface SignatureDialogProps {
  readonly title: string;
  readonly description?: string;
  readonly onClose: () => void;
  /** The uploaded and confirmed image, to send as the signature. */
  readonly onSigned: (fileId: string) => void;
}

/**
 * Drawing a signature (the help desk's signature box), or choosing an image of it for whoever cannot draw: either one
 * is uploaded as the person's own file, and its id goes where the signature is needed.
 */
export function SignatureDialog({ title, description, onClose, onSigned }: SignatureDialogProps) {
  const { t } = useTranslation('common');
  const client = useApiClient();
  const pad = useRef<SignaturePadHandle>(null);
  const input = useRef<HTMLInputElement>(null);
  const [hasInk, setHasInk] = useState(false);
  const [problem, setProblem] = useState<'type' | 'size'>();
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const [stored] = await uploadFiles(client, [file]);
      if (stored === undefined) throw new Error('The signature was not stored');
      return stored.id;
    },
    onSuccess: onSigned,
  });
  const confirmDrawing = async () => {
    const blob = await pad.current?.toBlob();
    if (blob != null) upload.mutate(new File([blob], 'firma.png', { type: 'image/png' }));
  };

  return (
    <Dialog
      open
      title={title}
      closeLabel={t('signature.close')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('signature.cancel')}</Button>
          <Button variant="primary" disabled={!hasInk || upload.isPending} onClick={() => void confirmDrawing()}>
            {upload.isPending ? t('signature.saving') : t('signature.use')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <p className={styles.note}>{description ?? t('signature.hint')}</p>
        <SignaturePad ref={pad} label={t('signature.pad')} onInkChange={setHasInk} />
        <div className={styles.row}>
          <Button variant="ghost" disabled={!hasInk || upload.isPending} onClick={() => pad.current?.clear()}>
            {t('signature.clear')}
          </Button>
          <Button variant="ghost" disabled={upload.isPending} onClick={() => input.current?.click()}>
            {t('signature.chooseImage')}
          </Button>
          <input
            ref={input}
            type="file"
            accept={ACCEPTED.join(',')}
            hidden
            aria-label={t('signature.image')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file === undefined) return;
              setProblem(undefined);
              if (!ACCEPTED.includes(file.type)) setProblem('type');
              else if (file.size > MAX_BYTES) setProblem('size');
              else upload.mutate(file);
            }}
          />
        </div>
        {problem !== undefined && <Alert tone="danger">{t(problem === 'type' ? 'signature.wrongType' : 'signature.tooLarge')}</Alert>}
        {upload.isError && <Alert tone="danger">{t('signature.failed')}</Alert>}
      </div>
    </Dialog>
  );
}

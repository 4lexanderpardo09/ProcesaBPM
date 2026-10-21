import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadFiles } from '@/shared/files/upload-files';
import { currentUserQueryKey, useApiClient } from '@/shared/session';
import { Alert, Button, Card } from '@/shared/ui';
import { clearSignature, profileQueryKeys, setSignature, signatureQueryOptions } from '../api/profile-api';
import { ProfileError } from './ProfileError';
import styles from './Profile.module.css';

const ACCEPTED = ['image/png', 'image/jpeg'];
/** A signature is a small image; anything larger is almost surely a photo of the whole page. */
const MAX_BYTES = 2 * 1024 * 1024;

/** The image of the person's signature, which goes on the PDF documents they sign. PNG or JPEG. */
export function SignatureCard() {
  const { t } = useTranslation('profile');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<'type' | 'size'>();
  const signature = useQuery(signatureQueryOptions(client));
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: profileQueryKeys.signature }), queryClient.invalidateQueries({ queryKey: currentUserQueryKey })]);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const [stored] = await uploadFiles(client, [file]);
      if (stored !== undefined) await setSignature(client, stored.id);
    },
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => clearSignature(client), onSuccess: refresh });
  const busy = upload.isPending || remove.isPending;

  return (
    <Card title={t('signature.title')}>
      <div className={styles.form}>
        <p className={styles.note}>{t('signature.hint')}</p>
        {signature.data === undefined ? (
          <p className={styles.note}>{signature.isError ? t('loadFailed') : t('loading')}</p>
        ) : signature.data === null ? (
          <p className={styles.note}>{t('signature.none')}</p>
        ) : (
          <img className={styles.signature} src={signature.data.url} alt={t('signature.alt')} />
        )}
        {problem !== undefined && <Alert tone="danger">{t(problem === 'type' ? 'signature.wrongType' : 'signature.tooLarge')}</Alert>}
        <ProfileError error={upload.error ?? remove.error} context="signature" />
        <input
          ref={input}
          type="file"
          accept={ACCEPTED.join(',')}
          hidden
          aria-label={t('signature.file')}
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
        <div className={styles.actions}>
          <Button variant="brand" disabled={busy} onClick={() => input.current?.click()}>
            {upload.isPending ? t('signature.uploading') : signature.data === null || signature.data === undefined ? t('signature.upload') : t('signature.replace')}
          </Button>
          {signature.data !== null && signature.data !== undefined && (
            <Button variant="ghost" disabled={busy} onClick={() => remove.mutate()}>
              {t('signature.remove')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

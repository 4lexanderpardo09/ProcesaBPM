import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminQueryKeys } from '@/shared/admin/admin-api';
import { uploadFiles } from '@/shared/files/upload-files';
import { useApiClient } from '@/shared/session';
import { Alert, Button } from '@/shared/ui';
import { clearMemberSignature, memberSignatureQueryOptions, setMemberSignature } from '../api/people-api';
import { PeopleError } from './PeopleError';
import styles from './People.module.css';

const ACCEPTED = ['image/png', 'image/jpeg'];
/** What a PDF draws, as for one's own signature. */
const MAX_BYTES = 1024 * 1024;

/**
 * The member's signature, for someone who signs documents but will not upload it: the administrator uploads the image
 * and it becomes theirs at once (it is not part of the dialog's "Guardar").
 */
export function MemberSignature({ userId, name }: { readonly userId: string; readonly name: string }) {
  const { t } = useTranslation('people');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<'type' | 'size'>();
  const signature = useQuery(memberSignatureQueryOptions(client, userId));
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.all, '/members', userId, 'signature'] });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const [stored] = await uploadFiles(client, [file]);
      if (stored !== undefined) await setMemberSignature(client, userId, stored.id);
    },
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => clearMemberSignature(client, userId), onSuccess: refresh });
  const busy = upload.isPending || remove.isPending;
  const has = signature.data !== null && signature.data !== undefined;

  return (
    <fieldset className={styles.choices}>
      <legend>{t('members.signature.title')}</legend>
      <p className={styles.note}>{t('members.signature.hint')}</p>
      {signature.data === undefined ? (
        <p className={styles.note}>{signature.isError ? t('members.signature.loadFailed') : t('members.signature.loading')}</p>
      ) : signature.data === null ? (
        <p className={styles.note}>{t('members.signature.none')}</p>
      ) : (
        <img className={styles.signature} src={signature.data.url} alt={t('members.signature.alt', { name })} />
      )}
      {problem !== undefined && <Alert tone="danger">{t(problem === 'type' ? 'members.signature.wrongType' : 'members.signature.tooLarge')}</Alert>}
      <PeopleError error={upload.error ?? remove.error} context="member" />
      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(',')}
        hidden
        aria-label={t('members.signature.file')}
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
      <div className={styles.signatureActions}>
        <Button disabled={busy} onClick={() => input.current?.click()}>
          {upload.isPending ? t('members.signature.uploading') : has ? t('members.signature.replace') : t('members.signature.upload')}
        </Button>
        {has && (
          <Button variant="ghost" disabled={busy} onClick={() => remove.mutate()}>
            {t('members.signature.remove')}
          </Button>
        )}
      </div>
    </fieldset>
  );
}

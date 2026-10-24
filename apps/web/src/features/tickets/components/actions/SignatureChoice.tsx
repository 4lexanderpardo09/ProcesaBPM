import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { signatureQueryOptions } from '@/features/profile';
import { useApiClient } from '@/shared/session';
import { SignatureDialog } from '@/shared/signature/SignatureDialog';
import { Button } from '@/shared/ui';
import styles from './TicketActions.module.css';

/** What the person signs with: the profile signature (`undefined`) or one drawn now (its file id). */
export interface SignatureChoiceState {
  readonly fileId: string | undefined;
  /** Nothing to sign with: no profile signature and none drawn. */
  readonly missing: boolean;
}

/**
 * The signature of a step that is signed, as the help desk asks for it: the profile one by default, or one drawn (or
 * chosen) at this moment for this step. Without a profile signature, one must be drawn to sign.
 */
export function useSignatureChoice() {
  const profile = useQuery(signatureQueryOptions(useApiClient()));
  const [fileId, setFileId] = useState<string>();
  const hasProfile = profile.data !== null && profile.data !== undefined;
  // Only a profile known to have no signature asks for one: if it cannot be read, the API decides.
  return { fileId, setFileId, hasProfile, loading: profile.data === undefined && !profile.isError, missing: fileId === undefined && profile.data === null };
}

export function SignatureChoice({ choice, showMissing }: { readonly choice: ReturnType<typeof useSignatureChoice>; readonly showMissing: boolean }) {
  const { t } = useTranslation('tickets');
  const [drawing, setDrawing] = useState(false);
  return (
    <fieldset className={styles.signature}>
      <legend className="text-label">{t('signature.title')}</legend>
      <p className={styles.signatureState}>
        {choice.fileId !== undefined ? t('signature.drawn') : choice.loading ? t('signature.loading') : choice.hasProfile ? t('signature.profile') : t('signature.none')}
      </p>
      <div className={styles.signatureActions}>
        <Button onClick={() => setDrawing(true)}>{choice.fileId === undefined ? t('signature.drawNow') : t('signature.redraw')}</Button>
        {choice.fileId !== undefined && choice.hasProfile && (
          <Button variant="ghost" onClick={() => choice.setFileId(undefined)}>
            {t('signature.useProfile')}
          </Button>
        )}
      </div>
      {showMissing && choice.missing && <span className={styles.signatureError}>{t('signature.required')}</span>}
      {drawing && (
        <SignatureDialog
          title={t('signature.dialogTitle')}
          description={t('signature.dialogHint')}
          onClose={() => setDrawing(false)}
          onSigned={(fileId) => {
            setDrawing(false);
            choice.setFileId(fileId);
          }}
        />
      )}
    </fieldset>
  );
}

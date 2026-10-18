import { zodResolver } from '@hookform/resolvers/zod';
import { type MfaCode, type MfaFactor, mfaCodeSchema, mfaFactorSchema } from '@procesabpm/shared';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button, TextField } from '@/shared/ui';
import styles from './auth-forms.module.css';
import { StepError } from './StepError';
import { StepHeading } from './StepHeading';

const backupCodeFormSchema = z.object({ backupCode: mfaFactorSchema.options[1].shape.backupCode });

export interface MfaChallengeFormProps {
  readonly method: 'totp' | 'backupCode';
  readonly busy: boolean;
  readonly error: unknown;
  readonly onSubmit: (factor: MfaFactor) => Promise<void>;
  readonly onSwitchMethod: () => void;
  readonly onRestart: () => void;
}

export function MfaChallengeForm({ method, busy, error, onSubmit, onSwitchMethod, onRestart }: MfaChallengeFormProps) {
  const { t } = useTranslation('auth');
  return (
    <div className={styles.form}>
      <StepHeading title={t('mfa.title')} description={t(method === 'totp' ? 'mfa.totpHelp' : 'mfa.backupHelp')} />
      {error !== undefined && <StepError error={error} context={method} />}
      {method === 'totp' ? <TotpForm busy={busy} onSubmit={onSubmit} /> : <BackupCodeForm busy={busy} onSubmit={onSubmit} />}
      <p className={styles.hint}>{t('errors.mfaLockHint')}</p>
      <button type="button" className={styles.linkButton} onClick={onSwitchMethod}>
        {t(method === 'totp' ? 'mfa.useBackup' : 'mfa.useTotp')}
      </button>
      <button type="button" className={styles.linkButton} onClick={onRestart}>
        {t('back')}
      </button>
    </div>
  );
}

interface FactorFormProps {
  readonly busy: boolean;
  readonly onSubmit: (factor: MfaFactor) => Promise<void>;
}

export interface TotpFormProps {
  readonly busy: boolean;
  readonly onSubmit: (body: MfaCode) => Promise<void>;
  readonly submitLabel?: string;
}

export function TotpForm({ busy, onSubmit, submitLabel }: TotpFormProps) {
  const { t } = useTranslation('auth');
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<MfaCode>({ resolver: zodResolver(mfaCodeSchema), defaultValues: { code: '' } });
  return (
    <form method="post" noValidate className={styles.form} onSubmit={handleSubmit((body) => onSubmit(body))}>
      <TextField
        label={t('mfa.code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        className={styles.code}
        required
        error={errors.code === undefined ? undefined : t('validation.totpInvalid')}
        {...register('code')}
      />
      <div className={styles.actions}>
        <Button type="submit" variant="brand" disabled={busy}>
          {submitLabel ?? t('mfa.submit')}
        </Button>
      </div>
    </form>
  );
}

function BackupCodeForm({ busy, onSubmit }: FactorFormProps) {
  const { t } = useTranslation('auth');
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ backupCode: string }>({ resolver: zodResolver(backupCodeFormSchema), defaultValues: { backupCode: '' } });
  return (
    <form method="post" noValidate className={styles.form} onSubmit={handleSubmit((body) => onSubmit({ backupCode: body.backupCode.trim() }))}>
      <TextField
        label={t('mfa.backupCode')}
        autoComplete="one-time-code"
        className={styles.code}
        required
        error={errors.backupCode === undefined ? undefined : t('validation.backupCodeInvalid')}
        {...register('backupCode')}
      />
      <div className={styles.actions}>
        <Button type="submit" variant="brand" disabled={busy}>
          {t('mfa.submit')}
        </Button>
      </div>
    </form>
  );
}

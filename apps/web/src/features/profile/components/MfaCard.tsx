import type { MfaEnrollment } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackupCodesPanel, CopyButton, groupSecret } from '@/features/auth';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { useApiClient } from '@/shared/session';
import { Alert, Badge, Button, Card, QrCode, TextField } from '@/shared/ui';
import { beginMfaEnrollment, confirmMfaEnrollment, disableMfa, mfaStatusQueryOptions, profileQueryKeys, regenerateBackupCodes } from '../api/profile-api';
import { ProfileError } from './ProfileError';
import styles from './Profile.module.css';

const CODE = /^\d{6}$/;

type Step = { readonly kind: 'idle' } | { readonly kind: 'enrolling'; readonly enrollment: MfaEnrollment } | { readonly kind: 'regenerating' } | { readonly kind: 'disabling' } | { readonly kind: 'codes'; readonly codes: readonly string[] };

/**
 * Two-step verification: turn it on (scan the QR, type a code and the password), get new backup codes, or turn it
 * off with the password and a code. An organization that requires it does not let it be turned off.
 */
export function MfaCard() {
  const { t } = useTranslation('profile');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const status = useQuery(mfaStatusQueryOptions(client));
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const refresh = () => queryClient.invalidateQueries({ queryKey: profileQueryKeys.mfa });
  const begin = useMutation({ mutationFn: () => beginMfaEnrollment(client), onSuccess: (enrollment) => setStep({ kind: 'enrolling', enrollment }) });
  const finish = () => {
    setStep({ kind: 'idle' });
    void refresh();
  };

  return (
    <Card title={t('mfa.title')}>
      <div className={styles.form}>
        {step.kind === 'codes' ? (
          <BackupCodesPanel codes={step.codes} onContinue={finish} />
        ) : status.data === undefined ? (
          <p className={styles.note}>{status.isError ? t('loadFailed') : t('loading')}</p>
        ) : !status.data.enabled ? (
          step.kind === 'enrolling' ? (
            <Enrollment enrollment={step.enrollment} onDone={(codes) => setStep({ kind: 'codes', codes })} onCancel={() => setStep({ kind: 'idle' })} />
          ) : (
            <>
              <p className={styles.status}>
                <Badge>{t('mfa.off')}</Badge>
                {t('mfa.offHint')}
              </p>
              {status.data.requiredByPolicy && <Alert tone="warn">{t('mfa.requiredHint')}</Alert>}
              <ProfileError error={begin.error} />
              <div className={styles.actions}>
                <Button variant="brand" disabled={begin.isPending} onClick={() => begin.mutate()}>
                  {t('mfa.turnOn')}
                </Button>
              </div>
            </>
          )
        ) : (
          <>
            <p className={styles.status}>
              <Badge tone="ok">{t('mfa.on')}</Badge>
              {status.data.enabledAt === null ? null : t('mfa.since', { date: formatDateTime(status.data.enabledAt) })}
            </p>
            <p className={styles.note}>{t('mfa.codesLeft', { count: status.data.backupCodesLeft })}</p>
            {step.kind === 'regenerating' && <Regenerate onDone={(codes) => setStep({ kind: 'codes', codes })} onCancel={() => setStep({ kind: 'idle' })} />}
            {step.kind === 'disabling' && <Disable onDone={finish} onCancel={() => setStep({ kind: 'idle' })} />}
            {step.kind === 'idle' && (
              <div className={styles.actions}>
                <Button onClick={() => setStep({ kind: 'regenerating' })}>{t('mfa.regenerate')}</Button>
                {!status.data.requiredByPolicy && (
                  <Button variant="ghost" onClick={() => setStep({ kind: 'disabling' })}>
                    {t('mfa.turnOff')}
                  </Button>
                )}
              </div>
            )}
            {status.data.requiredByPolicy && <p className={styles.note}>{t('mfa.requiredHint')}</p>}
          </>
        )}
      </div>
    </Card>
  );
}

function Enrollment({ enrollment, onDone, onCancel }: { readonly enrollment: MfaEnrollment; readonly onDone: (codes: readonly string[]) => void; readonly onCancel: () => void }) {
  const { t } = useTranslation(['profile', 'auth']);
  const client = useApiClient();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const confirm = useMutation({ mutationFn: () => confirmMfaEnrollment(client, code, password), onSuccess: (response) => onDone(response.backupCodes) });
  return (
    <form
      noValidate
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (CODE.test(code) && password !== '') confirm.mutate();
      }}
    >
      <p>{t('auth:enrollment.scan')}</p>
      <div className={styles.qr}>
        <QrCode value={enrollment.otpauthUri} label={t('auth:enrollment.qrLabel')} />
      </div>
      <p className={styles.note}>{t('auth:enrollment.manual')}</p>
      <div className={styles.secret}>
        <code className={styles.code}>{groupSecret(enrollment.secret)}</code>
        <CopyButton text={enrollment.secret} label={t('auth:enrollment.copySecret')} copiedLabel={t('auth:enrollment.secretCopied')} />
      </div>
      <div className={styles.pair}>
        <TextField label={t('mfa.code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} error={submitted && !CODE.test(code) ? t('mfa.codeInvalid') : undefined} onChange={(event) => setCode(event.target.value.trim())} />
        <TextField label={t('mfa.password')} type="password" autoComplete="current-password" required value={password} error={submitted && password === '' ? t('data.required') : undefined} onChange={(event) => setPassword(event.target.value)} />
      </div>
      <ProfileError error={confirm.error} context="code" />
      <div className={styles.actions}>
        <Button type="submit" variant="brand" disabled={confirm.isPending}>
          {t('mfa.confirm')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function Regenerate({ onDone, onCancel }: { readonly onDone: (codes: readonly string[]) => void; readonly onCancel: () => void }) {
  const { t } = useTranslation('profile');
  const client = useApiClient();
  const [code, setCode] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const regenerate = useMutation({ mutationFn: () => regenerateBackupCodes(client, code), onSuccess: (response) => onDone(response.backupCodes) });
  return (
    <form
      noValidate
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (CODE.test(code)) regenerate.mutate();
      }}
    >
      <p className={styles.note}>{t('mfa.regenerateHint')}</p>
      <TextField label={t('mfa.code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} error={submitted && !CODE.test(code) ? t('mfa.codeInvalid') : undefined} onChange={(event) => setCode(event.target.value.trim())} />
      <ProfileError error={regenerate.error} context="code" />
      <div className={styles.actions}>
        <Button type="submit" variant="brand" disabled={regenerate.isPending}>
          {t('mfa.regenerate')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

function Disable({ onDone, onCancel }: { readonly onDone: () => void; readonly onCancel: () => void }) {
  const { t } = useTranslation('profile');
  const client = useApiClient();
  const [password, setPassword] = useState('');
  const [factor, setFactor] = useState<'code' | 'backupCode'>('code');
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const disable = useMutation({ mutationFn: () => disableMfa(client, factor === 'code' ? { password, code: value } : { password, backupCode: value }), onSuccess: onDone });
  const valueInvalid = factor === 'code' ? !CODE.test(value) : value === '';
  return (
    <form
      noValidate
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (password !== '' && !valueInvalid) disable.mutate();
      }}
    >
      <Alert tone="warn">{t('mfa.turnOffWarning')}</Alert>
      <div className={styles.pair}>
        <TextField label={t('mfa.password')} type="password" autoComplete="current-password" required value={password} error={submitted && password === '' ? t('data.required') : undefined} onChange={(event) => setPassword(event.target.value)} />
        <TextField
          label={factor === 'code' ? t('mfa.code') : t('mfa.backupCode')}
          inputMode={factor === 'code' ? 'numeric' : 'text'}
          autoComplete="one-time-code"
          required
          value={value}
          error={submitted && valueInvalid ? (factor === 'code' ? t('mfa.codeInvalid') : t('data.required')) : undefined}
          onChange={(event) => setValue(event.target.value.trim())}
        />
      </div>
      <div>
        <Button
          variant="ghost"
          onClick={() => {
            setFactor(factor === 'code' ? 'backupCode' : 'code');
            setValue('');
          }}
        >
          {factor === 'code' ? t('mfa.useBackupCode') : t('mfa.useCode')}
        </Button>
      </div>
      <ProfileError error={disable.error} context={factor} />
      <div className={styles.actions}>
        <Button type="submit" variant="brand" disabled={disable.isPending}>
          {t('mfa.turnOff')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

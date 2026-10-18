import type { MfaCode, MfaEnrollment, MfaEnrollmentRequiredResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { QrCode } from '@/shared/ui';
import { CopyButton } from './CopyButton';
import styles from './auth-forms.module.css';
import { TotpForm } from './MfaChallengeForm';
import panel from './MfaEnrollmentPanel.module.css';
import { StepError } from './StepError';
import { StepHeading } from './StepHeading';

export interface MfaEnrollmentPanelProps {
  readonly reason: MfaEnrollmentRequiredResponse['reason'];
  readonly enrollment: MfaEnrollment;
  readonly busy: boolean;
  readonly error: unknown;
  readonly onSubmit: (body: MfaCode) => Promise<void>;
  readonly onRestart: () => void;
}

/** Groups the secret in fours so it can be typed by hand. */
export function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

export function MfaEnrollmentPanel({ reason, enrollment, busy, error, onSubmit, onRestart }: MfaEnrollmentPanelProps) {
  const { t } = useTranslation('auth');
  return (
    <div className={styles.form}>
      <StepHeading title={t('enrollment.title')} description={t(reason === 'PLATFORM_ADMIN' ? 'enrollment.reasonPlatform' : 'enrollment.reasonTenant')} />
      {error !== undefined && <StepError error={error} context="enrollment" />}
      <p>{t('enrollment.scan')}</p>
      <div className={panel.qr}>
        <QrCode value={enrollment.otpauthUri} label={t('enrollment.qrLabel')} />
      </div>
      <p className={styles.hint}>{t('enrollment.manual')}</p>
      <div className={panel.secret}>
        <code className={styles.code}>{groupSecret(enrollment.secret)}</code>
        <CopyButton text={enrollment.secret} label={t('enrollment.copySecret')} copiedLabel={t('enrollment.secretCopied')} />
      </div>
      <p>{t('enrollment.enterCode')}</p>
      <TotpForm busy={busy} onSubmit={onSubmit} submitLabel={t('enrollment.submit')} />
      <button type="button" className={styles.linkButton} onClick={onRestart}>
        {t('back')}
      </button>
    </div>
  );
}

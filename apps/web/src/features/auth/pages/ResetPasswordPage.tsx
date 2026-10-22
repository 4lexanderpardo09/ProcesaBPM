import { ERROR_CODES } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '@/shared/api';
import { loginPath, paths } from '@/shared/lib/paths';
import { useSessionManager } from '@/shared/session';
import { Alert, Button } from '@/shared/ui';
import { confirmPasswordReset } from '../api/account-api';
import { AuthPanel } from '../components/AuthPanel';
import styles from '../components/auth-forms.module.css';
import { type NewPassword, NewPasswordFields, newPasswordProblem } from '../components/NewPasswordFields';
import { StepError } from '../components/StepError';
import { StepHeading } from '../components/StepHeading';
import { useLinkToken } from '../lib/link-token';

/** The page the reset e-mail links to: a new password typed twice, then the sign-in. */
export function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  const { publicClient } = useSessionManager();
  const navigate = useNavigate();
  const token = useLinkToken();
  const [value, setValue] = useState<NewPassword>({ password: '', repeat: '' });
  const [submitted, setSubmitted] = useState(false);
  const reset = useMutation({
    mutationFn: () => confirmPasswordReset(publicClient, { token: token!, newPassword: value.password }),
    onSuccess: () => void navigate(loginPath(undefined, 'passwordChanged'), { replace: true }),
  });
  const expired = token === undefined || (reset.error instanceof ApiError && reset.error.code === ERROR_CODES.invalidToken);

  if (expired) {
    return (
      <AuthPanel>
        <div className={styles.form}>
          <StepHeading title={t('resetPassword.expiredTitle')} description={t('resetPassword.expiredBody')} />
          <Link to={paths.forgotPassword} className={styles.link}>
            {t('resetPassword.askAgain')}
          </Link>
        </div>
      </AuthPanel>
    );
  }
  return (
    <AuthPanel>
      <form
        method="post"
        noValidate
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (newPasswordProblem(value) === undefined && !reset.isPending) reset.mutate();
        }}
      >
        <StepHeading title={t('resetPassword.title')} description={t('resetPassword.body')} />
        {reset.error !== null && <StepError error={reset.error} context="credentials" />}
        <NewPasswordFields value={value} submitted={submitted} onChange={setValue} />
        <Alert tone="info">{t('resetPassword.sessionsHint')}</Alert>
        <div className={styles.actions}>
          <Button type="submit" variant="brand" disabled={reset.isPending}>
            {reset.isPending ? t('resetPassword.saving') : t('resetPassword.submit')}
          </Button>
        </div>
      </form>
    </AuthPanel>
  );
}

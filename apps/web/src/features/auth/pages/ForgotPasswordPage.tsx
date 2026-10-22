import { emailSchema } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { paths } from '@/shared/lib/paths';
import { useSessionManager } from '@/shared/session';
import { Alert, Button, TextField } from '@/shared/ui';
import { requestPasswordReset } from '../api/account-api';
import { AuthPanel } from '../components/AuthPanel';
import styles from '../components/auth-forms.module.css';
import { StepError } from '../components/StepError';
import { StepHeading } from '../components/StepHeading';

/**
 * Asks for a reset link. The answer is the same whether or not the e-mail has an account, so the page never tells
 * which addresses exist: it only says to check the inbox.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const { publicClient } = useSessionManager();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const send = useMutation({ mutationFn: () => requestPasswordReset(publicClient, email.trim()) });
  const valid = emailSchema.safeParse(email.trim()).success;
  const emailError = !submitted || valid ? undefined : t(email.trim() === '' ? 'validation.emailRequired' : 'validation.emailInvalid');

  return (
    <AuthPanel>
      {send.isSuccess ? (
        <div className={styles.form}>
          <StepHeading title={t('forgotPassword.sentTitle')} description={t('forgotPassword.sentBody', { email: email.trim() })} />
          <Link to={paths.login} className={styles.link}>
            {t('back')}
          </Link>
        </div>
      ) : (
        <form
          method="post"
          noValidate
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            if (valid && !send.isPending) send.mutate();
          }}
        >
          <StepHeading title={t('forgotPassword.title')} description={t('forgotPassword.body')} />
          {send.error !== null && <StepError error={send.error} context="credentials" />}
          <TextField label={t('login.email')} type="email" autoComplete="username" required error={emailError} value={email} onChange={(event) => setEmail(event.target.value)} />
          <div className={styles.actions}>
            <Button type="submit" variant="brand" disabled={send.isPending}>
              {send.isPending ? t('forgotPassword.sending') : t('forgotPassword.submit')}
            </Button>
          </div>
          <Link to={paths.login} className={styles.link}>
            {t('back')}
          </Link>
        </form>
      )}
      {send.isSuccess && <Alert tone="info">{t('forgotPassword.spamHint')}</Alert>}
    </AuthPanel>
  );
}

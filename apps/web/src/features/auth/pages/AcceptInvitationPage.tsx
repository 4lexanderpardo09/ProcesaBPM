import { ERROR_CODES } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '@/shared/api';
import { loginPath, paths } from '@/shared/lib/paths';
import { useSessionManager } from '@/shared/session';
import { Button } from '@/shared/ui';
import { acceptInvitation } from '../api/account-api';
import { AuthPanel } from '../components/AuthPanel';
import styles from '../components/auth-forms.module.css';
import { type NewPassword, NewPasswordFields, newPasswordProblem } from '../components/NewPasswordFields';
import { StepError } from '../components/StepError';
import { StepHeading } from '../components/StepHeading';
import { useLinkToken } from '../lib/link-token';

const isCode = (error: unknown, code: string) => error instanceof ApiError && error.code === code;

/**
 * The page the invitation e-mail links to. It first accepts with no password: someone who already has an account just
 * joins. Someone new gets an answer that a password is missing (the link still works), and chooses one here.
 */
export function AcceptInvitationPage() {
  const { t } = useTranslation('auth');
  const { publicClient } = useSessionManager();
  const navigate = useNavigate();
  const token = useLinkToken();
  const [value, setValue] = useState<NewPassword>({ password: '', repeat: '' });
  const [submitted, setSubmitted] = useState(false);
  // Once the API said a password is missing, the form stays until the invitation is accepted.
  const [askPassword, setAskPassword] = useState(false);
  const accept = useMutation({
    mutationFn: (password: string | undefined) => acceptInvitation(publicClient, { token: token!, ...(password === undefined ? {} : { password }) }),
    onSuccess: () => void navigate(loginPath(undefined, 'invitationAccepted'), { replace: true }),
    onError: (error) => {
      if (isCode(error, ERROR_CODES.invalidState)) setAskPassword(true);
    },
  });
  const tried = useRef(false);
  useEffect(() => {
    if (token === undefined || tried.current) return;
    tried.current = true;
    accept.mutate(undefined);
  }, [token, accept]);

  if (token === undefined || isCode(accept.error, ERROR_CODES.invalidToken)) {
    return (
      <AuthPanel>
        <div className={styles.form}>
          <StepHeading title={t('invitation.expiredTitle')} description={t('invitation.expiredBody')} />
          <Link to={paths.login} className={styles.link}>
            {t('invitation.toLogin')}
          </Link>
        </div>
      </AuthPanel>
    );
  }
  if (!askPassword) {
    return (
      <AuthPanel>
        <div className={styles.form}>
          <StepHeading title={t('invitation.title')} description={accept.error === null ? t('invitation.joining') : undefined} />
          {accept.error !== null && <StepError error={accept.error} context="credentials" />}
          {accept.error !== null && (
            <Button variant="brand" onClick={() => accept.mutate(undefined)}>
              {t('invitation.retry')}
            </Button>
          )}
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
          if (newPasswordProblem(value) === undefined && !accept.isPending) accept.mutate(value.password);
        }}
      >
        <StepHeading title={t('invitation.title')} description={t('invitation.choosePassword')} />
        {accept.error !== null && !isCode(accept.error, ERROR_CODES.invalidState) && <StepError error={accept.error} context="credentials" />}
        <NewPasswordFields value={value} submitted={submitted} onChange={setValue} />
        <div className={styles.actions}>
          <Button type="submit" variant="brand" disabled={accept.isPending}>
            {accept.isPending ? t('invitation.joiningShort') : t('invitation.submit')}
          </Button>
        </div>
      </form>
    </AuthPanel>
  );
}

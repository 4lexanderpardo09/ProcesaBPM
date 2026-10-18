import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginRequest, loginRequestSchema } from '@procesabpm/shared';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { paths } from '@/shared/lib/paths';
import { Button, TextField } from '@/shared/ui';
import { useRetryCountdown } from '../hooks/use-retry-countdown';
import styles from './auth-forms.module.css';
import { StepError } from './StepError';
import { StepHeading } from './StepHeading';

export interface CredentialsFormProps {
  readonly busy: boolean;
  readonly error: unknown;
  readonly onSubmit: (body: LoginRequest) => Promise<void>;
}

export function CredentialsForm({ busy, error, onSubmit }: CredentialsFormProps) {
  const { t } = useTranslation('auth');
  const waiting = useRetryCountdown(error);
  const {
    register,
    handleSubmit,
    getValues,
    resetField,
    formState: { errors },
  } = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema), defaultValues: { email: '', password: '' } });

  const submit = handleSubmit(async (body) => {
    await onSubmit(body);
    resetField('password');
  });

  const emailError = errors.email === undefined ? undefined : t(getValues('email').trim() === '' ? 'validation.emailRequired' : 'validation.emailInvalid');

  return (
    <form method="post" noValidate className={styles.form} onSubmit={submit}>
      <StepHeading title={t('login.title')} />
      {error !== undefined && <StepError error={error} context="credentials" />}
      <TextField label={t('login.email')} type="email" autoComplete="username" required error={emailError} {...register('email')} />
      <TextField
        label={t('login.password')}
        type="password"
        autoComplete="current-password"
        required
        error={errors.password === undefined ? undefined : t('validation.passwordRequired')}
        hint={t('errors.invalidCredentialsHint')}
        {...register('password')}
      />
      <div className={styles.actions}>
        <Button type="submit" variant="brand" disabled={busy || waiting}>
          {t('login.submit')}
        </Button>
      </div>
      <Link to={paths.forgotPassword} className={styles.link}>
        {t('login.forgot')}
      </Link>
    </form>
  );
}

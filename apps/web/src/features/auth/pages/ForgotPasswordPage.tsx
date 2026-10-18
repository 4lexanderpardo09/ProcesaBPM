import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { paths } from '@/shared/lib/paths';
import { AuthCard } from '../components/AuthCard';
import styles from '../components/auth-forms.module.css';
import { StepHeading } from '../components/StepHeading';

/** Placeholder until password recovery is built: the security e-mails already link here. */
export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  return (
    <AuthCard>
      <StepHeading title={t('forgotPassword.title')} description={t('forgotPassword.body')} />
      <Link to={paths.login} className={styles.link}>
        {t('back')}
      </Link>
    </AuthCard>
  );
}

import { ApiError } from '@/shared/api';
import { ERROR_CODES } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui';
import { authErrorMessage, type AuthErrorContext } from '../lib/auth-error-message';
import { MaintenanceNotice } from './MaintenanceNotice';

/** The error of a failed step. A sign-in-wide maintenance block shows its announcement instead. */
export function StepError({ error, context }: { readonly error: unknown; readonly context: AuthErrorContext }) {
  const { t } = useTranslation(['auth', 'common']);
  if (error instanceof ApiError && error.code === ERROR_CODES.maintenance) return <MaintenanceNotice details={error.details} />;
  const message = authErrorMessage(error, context);
  return <Alert tone="danger">{t(message.key, message.values ?? {})}</Alert>;
}

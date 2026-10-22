import { useTranslation } from 'react-i18next';
import { ApiError, genericErrorMessage } from '@/shared/api';
import { Alert } from '@/shared/ui';

/** Why a change of the settings did not go through; nothing without an error. Never the API's own text. */
export function SettingsError({ error }: { readonly error: unknown }) {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation();
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError && error.status === 403) return <Alert tone="danger">{t('errors.forbidden')}</Alert>;
  if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') return <Alert tone="danger">{t('errors.password')}</Alert>;
  if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') return <Alert tone="danger">{t('errors.invalid')}</Alert>;
  const generic = genericErrorMessage(error);
  return <Alert tone="danger">{'values' in generic ? tCommon(generic.key, generic.values) : tCommon(generic.key)}</Alert>;
}

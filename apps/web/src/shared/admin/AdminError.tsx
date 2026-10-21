import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui';
import { adminErrorMessage } from './admin-error';

/** Why a catalog change did not go through; nothing without an error. */
export function AdminError({ error }: { readonly error: unknown }) {
  const { t } = useTranslation('admin');
  const { t: tCommon } = useTranslation();
  if (error === null || error === undefined) return null;
  const message = adminErrorMessage(error);
  if (message.namespace === 'admin') return <Alert tone="danger">{t(message.key)}</Alert>;
  return <Alert tone="danger">{'values' in message ? tCommon(message.key, message.values) : tCommon(message.key)}</Alert>;
}

import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui';
import { catalogErrorMessage } from '../lib/catalog-error';

/** Why a catalog change did not go through; nothing without an error. */
export function CatalogError({ error }: { readonly error: unknown }) {
  const { t } = useTranslation('catalog');
  const { t: tCommon } = useTranslation();
  if (error === null || error === undefined) return null;
  const message = catalogErrorMessage(error);
  if (message.namespace === 'catalog') return <Alert tone="danger">{t(message.key)}</Alert>;
  return <Alert tone="danger">{'values' in message ? tCommon(message.key, message.values) : tCommon(message.key)}</Alert>;
}

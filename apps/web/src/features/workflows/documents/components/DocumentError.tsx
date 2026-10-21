import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui';
import { type DocumentErrorContext, documentErrorMessage } from '../lib/document-error';

/** Why a change to a PDF document did not go through; nothing without an error. */
export function DocumentError({ error, context }: { readonly error: unknown; readonly context?: DocumentErrorContext }) {
  const { t } = useTranslation('workflows');
  const { t: tCommon } = useTranslation();
  if (error === null || error === undefined) return null;
  const message = documentErrorMessage(error, context);
  if (message.namespace === 'workflows') return <Alert tone="danger">{t(message.key)}</Alert>;
  return <Alert tone="danger">{'values' in message ? tCommon(message.key, message.values) : tCommon(message.key)}</Alert>;
}

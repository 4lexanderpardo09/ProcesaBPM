import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui';
import { actionErrorMessage } from '../../lib/action-error-message';

/** Why the action did not go through, in words the person can act on (never the API's own message). */
export function ActionError({ error }: { readonly error: unknown }) {
  const { t } = useTranslation('tickets');
  const { t: tCommon } = useTranslation();
  const message = actionErrorMessage(error);
  if (message.namespace === 'tickets') return <Alert tone="danger">{'values' in message ? t(message.key, message.values) : t(message.key)}</Alert>;
  return <Alert tone="danger">{'values' in message ? tCommon(message.key, message.values) : tCommon(message.key)}</Alert>;
}

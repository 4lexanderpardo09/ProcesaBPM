import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui';
import { type WorkflowErrorContext, workflowErrorMessage } from '../lib/workflow-error';

/** Why a change to a workflow did not go through; nothing without an error. */
export function WorkflowError({ error, context }: { readonly error: unknown; readonly context: WorkflowErrorContext }) {
  const { t } = useTranslation('workflows');
  const { t: tCommon } = useTranslation();
  if (error === null || error === undefined) return null;
  const message = workflowErrorMessage(error, context);
  if (message.namespace === 'workflows') return <Alert tone="danger">{t(message.key as 'errors.invalid')}</Alert>;
  return <Alert tone="danger">{'values' in message ? tCommon(message.key, message.values) : tCommon(message.key)}</Alert>;
}

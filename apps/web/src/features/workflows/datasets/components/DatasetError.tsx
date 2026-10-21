import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui';
import { type DatasetErrorContext, datasetErrorMessage } from '../lib/dataset-error';

/** Why a change to a dataset did not go through; nothing without an error. */
export function DatasetError({ error, context }: { readonly error: unknown; readonly context: DatasetErrorContext }) {
  const { t } = useTranslation('workflows');
  const { t: tCommon } = useTranslation();
  if (error === null || error === undefined) return null;
  const message = datasetErrorMessage(error, context);
  if (message.namespace === 'workflows') return <Alert tone="danger">{t(message.key as 'datasets.errors.columnsInUse', { columns: message.values?.columns ?? '', detail: message.values?.detail ?? '' })}</Alert>;
  return <Alert tone="danger">{'values' in message ? tCommon(message.key, message.values) : tCommon(message.key)}</Alert>;
}

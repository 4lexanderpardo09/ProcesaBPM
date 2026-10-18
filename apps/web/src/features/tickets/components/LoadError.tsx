import { useTranslation } from 'react-i18next';
import { genericErrorMessage } from '@/shared/api';
import { Alert, Button } from '@/shared/ui';
import styles from './LoadError.module.css';

/** Something could not be loaded: what went wrong, and a way to try again. */
export function LoadError({ error, onRetry }: { readonly error: unknown; readonly onRetry: () => void }) {
  const { t } = useTranslation('tickets');
  const { t: tCommon } = useTranslation();
  const message = genericErrorMessage(error);
  return (
    <Alert tone="danger">
      <div className={styles.error}>
        <span>{'values' in message ? tCommon(message.key, message.values) : tCommon(message.key)}</span>
        <Button onClick={onRetry}>{t('retry')}</Button>
      </div>
    </Alert>
  );
}

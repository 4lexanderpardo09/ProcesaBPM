import { useTranslation } from 'react-i18next';
import { ApiError, genericErrorMessage } from '@/shared/api';
import { Alert, Button } from '@/shared/ui';

/** The API's refusals the console explains; anything else reads as the generic message (no connection, unexpected). */
const KNOWN = ['DUPLICATE', 'INVALID_STATE', 'NOT_FOUND', 'VALIDATION_FAILED', 'INVALID_REFERENCE', 'SUPPORT_ACCESS_NOT_GRANTED'] as const;
type Known = (typeof KNOWN)[number];
const isKnown = (code: string): code is Known => (KNOWN as readonly string[]).includes(code);

/** A request of the console that failed, with a retry when it makes sense. */
export function PlatformError({ error, onRetry }: { readonly error: unknown; readonly onRetry?: () => void }) {
  const { t } = useTranslation(['platform', 'common']);
  const generic = genericErrorMessage(error);
  const text = error instanceof ApiError && isKnown(error.code) ? t(`errors.${error.code}`) : 'values' in generic ? t(generic.key, { ns: 'common', ...generic.values }) : t(generic.key, { ns: 'common' });
  return (
    <Alert tone="danger">
      {text}{' '}
      {onRetry !== undefined && (
        <Button variant="ghost" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

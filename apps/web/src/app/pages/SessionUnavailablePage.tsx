import { useTranslation } from 'react-i18next';
import { useSessionManager } from '@/shared/session';
import { SessionScreen } from './SessionScreen';

export function SessionUnavailablePage() {
  const { t } = useTranslation('auth');
  const manager = useSessionManager();
  return <SessionScreen title={t('session.unavailableTitle')} body={t('session.unavailableBody')} onRetry={manager.retry} />;
}

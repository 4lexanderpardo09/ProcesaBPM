import { useTranslation } from 'react-i18next';
import { SessionScreen } from './SessionScreen';

/** The organization is being deleted and this person may only export its data (the export screen comes later). */
export function DeletionPendingPage() {
  const { t } = useTranslation('auth');
  return <SessionScreen title={t('session.deletionPendingTitle')} body={t('session.deletionPendingBody')} />;
}

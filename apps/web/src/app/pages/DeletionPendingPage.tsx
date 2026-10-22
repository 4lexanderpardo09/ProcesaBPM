import { useTranslation } from 'react-i18next';
import { DataExportPanel } from '@/features/settings';
import { useCurrentUser } from '@/shared/session';
import { SessionScreen } from './SessionScreen';

/** The organization is being deleted: its owner and administrators may still take a copy of its data. */
export function DeletionPendingPage() {
  const { t } = useTranslation('auth');
  const membership = useCurrentUser().data?.membership;
  const mayExport = membership !== undefined && (membership.isOwner || membership.role.isAdmin);
  return (
    <SessionScreen title={t('session.deletionPendingTitle')} body={mayExport ? t('session.deletionPendingExport') : t('session.deletionPendingBody')}>
      {mayExport && <DataExportPanel />}
    </SessionScreen>
  );
}

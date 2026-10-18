import { useTranslation } from 'react-i18next';
import { MaintenanceNotice } from '@/features/auth';
import { type SessionBlock, useSessionManager } from '@/shared/session';
import { SessionScreen } from './SessionScreen';

export function SessionBlockedPage({ block }: { readonly block: SessionBlock }) {
  const { t } = useTranslation('auth');
  const manager = useSessionManager();
  switch (block.kind) {
    case 'maintenance':
      return (
        <SessionScreen title={t('maintenance.title')} onRetry={manager.retry}>
          <MaintenanceNotice details={block.details} />
        </SessionScreen>
      );
    case 'tenantSuspended':
      return <SessionScreen title={t('session.suspendedTitle')} body={t('session.suspendedBody')} />;
    case 'tenantPendingDeletion':
      return <SessionScreen title={t('session.pendingDeletionTitle')} body={t('session.pendingDeletionBody')} />;
  }
}

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { paths } from '@/shared/lib/paths';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { Alert, ButtonLink, Card, PageHeader } from '@/shared/ui';
import { ticketBatchGroupsQueryOptions } from '../api/batch-api';
import { LoadError } from '../components/LoadError';
import { BatchGroupCard } from '../components/batch/BatchGroupCard';
import styles from '../components/batch/Batch.module.css';

/**
 * "Procesar en lote": the person's tickets on steps that take batches, a card per step, each answered for several at once.
 * `?cutoff=` keeps only the tickets that went out in that export file ("Procesar sus tickets" from the file).
 */
export function TicketBatchPage() {
  const { t } = useTranslation('tickets');
  const cutoffId = useSearchParams()[0].get('cutoff') ?? undefined;
  const groups = useQuery(ticketBatchGroupsQueryOptions(useApiClient(), cutoffId));
  const timeZone = useCurrentUser().data?.user.timeZone ?? undefined;
  return (
    <>
      <PageHeader title={t('batch.title')} subtitle={t('batch.subtitle')} actions={<ButtonLink to={paths.tickets}>{t('batch.back')}</ButtonLink>} />
      {cutoffId !== undefined && (
        <div className={styles.filter}>
          <Alert tone="info">
            {t('batch.fromCutoff')} <Link to={paths.ticketBatches}>{t('batch.allTickets')}</Link>
          </Alert>
        </div>
      )}
      {groups.isError ? (
        <LoadError error={groups.error} onRetry={() => void groups.refetch()} />
      ) : groups.data === undefined ? (
        <p className={styles.note}>{t('detail.loading')}</p>
      ) : groups.data.length === 0 ? (
        <Card>
          <p className={styles.note}>{t('batch.empty')}</p>
        </Card>
      ) : (
        <div className={styles.groups}>
          {groups.data.map((group) => (
            <BatchGroupCard key={`${group.workflowVersionId}:${group.stepId}`} group={group} timeZone={timeZone} />
          ))}
        </div>
      )}
    </>
  );
}

import type { TicketDetailResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Badge, type BadgeTone, Card } from '@/shared/ui';
import styles from './TicketAttachments.module.css';

type ParallelTask = TicketDetailResponse['parallelTasks'][number];

const TONE: Readonly<Record<ParallelTask['status'], BadgeTone>> = { PENDING: 'warn', SIGNED: 'ok', REJECTED: 'danger', CANCELLED: 'neutral' };

export interface TicketParallelSignaturesProps {
  readonly tasks: TicketDetailResponse['parallelTasks'];
  readonly timeZone: string | undefined;
}

/** Who has to sign the current parallel step and who already did; nothing on any other step. */
export function TicketParallelSignatures({ tasks, timeZone }: TicketParallelSignaturesProps) {
  const { t } = useTranslation('tickets');
  if (tasks.length === 0) return null;
  const signed = tasks.filter((task) => task.status === 'SIGNED').length;
  return (
    <Card title={t('detail.parallel.title')}>
      <p className={styles.muted}>{t('detail.parallel.progress', { signed, total: tasks.length })}</p>
      <ul className={styles.files}>
        {tasks.map((task) => (
          <li key={task.id} className={styles.file}>
            <div className={styles.fileText}>
              <span className={styles.label}>{task.name}</span>
              {task.completedAt !== null && <span className={styles.meta}>{formatDateTime(task.completedAt, timeZone)}</span>}
            </div>
            <Badge tone={TONE[task.status]}>{t(`detail.parallel.status.${task.status}`)}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

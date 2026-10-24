import type { TicketFlowResponse, TicketFlowVisitResponse } from '@procesabpm/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Badge, type BadgeTone, Card } from '@/shared/ui';
import styles from './TicketAttachments.module.css';

type Timing = { readonly key: 'onTime' | 'late' | 'overdue' | 'due' | 'none'; readonly tone: BadgeTone };

/** Whether a visit was left in time, is still within its deadline, or has none. */
export function visitTiming(visit: TicketFlowVisitResponse, now: Date): Timing {
  if (visit.result === 'ON_TIME') return { key: 'onTime', tone: 'ok' };
  if (visit.result === 'LATE') return { key: 'late', tone: 'danger' };
  if (visit.dueAt === null) return { key: 'none', tone: 'neutral' };
  if (visit.exitedAt !== null) return { key: 'none', tone: 'neutral' };
  return new Date(visit.dueAt) < now ? { key: 'overdue', tone: 'danger' } : { key: 'due', tone: 'warn' };
}

export interface TicketStepTimesProps {
  readonly flow: UseQueryResult<TicketFlowResponse>;
  readonly timeZone: string | undefined;
}

/** Each step the ticket went through, when it got there and left, and whether that was in time; nothing before the ticket reaches a people step. */
export function TicketStepTimes({ flow, timeZone }: TicketStepTimesProps) {
  const { t } = useTranslation('tickets');
  const visits = flow.data?.visits ?? [];
  if (visits.length === 0) return null;
  const names = new Map((flow.data?.steps ?? []).map((step) => [step.id, step.name]));
  const now = new Date();
  return (
    <Card title={t('detail.times.title')}>
      <ol className={styles.files} aria-label={t('detail.times.title')}>
        {visits.map((visit) => {
          const timing = visitTiming(visit, now);
          const name = names.get(visit.stepId) ?? t('detail.times.unknownStep');
          return (
            <li key={`${visit.stepId}-${String(visit.loop)}-${visit.enteredAt}`} className={styles.file}>
              <div className={styles.fileText}>
                <span className={styles.label}>{visit.loop > 1 ? t('detail.times.loop', { step: name, loop: visit.loop }) : name}</span>
                <span className={styles.meta}>
                  {visit.exitedAt === null
                    ? t('detail.times.since', { date: formatDateTime(visit.enteredAt, timeZone) })
                    : t('detail.times.range', { from: formatDateTime(visit.enteredAt, timeZone), to: formatDateTime(visit.exitedAt, timeZone) })}
                </span>
                {visit.dueAt !== null && <span className={styles.meta}>{t('detail.times.dueAt', { date: formatDateTime(visit.dueAt, timeZone) })}</span>}
              </div>
              {timing.key !== 'none' && <Badge tone={timing.tone}>{t(`detail.times.${timing.key}`)}</Badge>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

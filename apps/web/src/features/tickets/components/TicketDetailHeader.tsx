import type { TicketDetailResponse } from '@procesabpm/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/shared/lib/cx';
import { paths } from '@/shared/lib/paths';
import { Badge, Breadcrumb } from '@/shared/ui';
import type { SlaBadge } from '../lib/sla-badge';
import styles from './TicketDetailHeader.module.css';
import { TicketStatusBadge } from './TicketStatusBadge';

export interface TicketDetailHeaderProps {
  readonly ticket: TicketDetailResponse;
  readonly sla: SlaBadge | undefined;
  /** What the person can do on the ticket, on the right of the title. */
  readonly actions?: ReactNode;
}

/** Where the ticket sits (back to the inbox), its number and title, and its state, SLA and priority at a glance. */
export function TicketDetailHeader({ ticket, sla, actions }: TicketDetailHeaderProps) {
  const { t } = useTranslation('tickets');
  return (
    <header className={styles.header}>
      <Breadcrumb label={t('detail.breadcrumb')} items={[{ label: t('inbox.title'), to: paths.tickets }, { label: ticket.number, code: true }]} />
      <div className={styles.top}>
        <div className={styles.summary}>
          <div className={styles.titleRow}>
            <span className={cx('text-code', styles.number)}>{ticket.number}</span>
            <h1 className="text-ticket-title">{ticket.title}</h1>
          </div>
          <div className={styles.badges}>
            <TicketStatusBadge status={ticket.status} />
            {sla !== undefined && <Badge tone={sla.tone}>{slaText(sla)}</Badge>}
            {ticket.priority !== null && <Badge>{t('detail.priority', { name: ticket.priority.name })}</Badge>}
          </div>
        </div>
        {actions}
      </div>
    </header>
  );

  function slaText(badge: SlaBadge): string {
    switch (badge.kind) {
      case 'overdue':
        return t('detail.sla.overdue');
      case 'paused':
        return t('detail.sla.paused');
      case 'remaining':
        if (badge.days > 0) return t('detail.sla.days', { days: badge.days, hours: badge.hours });
        if (badge.hours > 0) return t('detail.sla.hours', { hours: badge.hours, minutes: badge.minutes });
        return t('detail.sla.minutes', { minutes: badge.minutes });
    }
  }
}

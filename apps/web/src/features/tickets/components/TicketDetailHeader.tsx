import type { TicketDetailResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { cx } from '@/shared/lib/cx';
import { paths } from '@/shared/lib/paths';
import { Badge } from '@/shared/ui';
import type { SlaBadge } from '../lib/sla-badge';
import styles from './TicketDetailHeader.module.css';
import { TicketStatusBadge } from './TicketStatusBadge';

export interface TicketDetailHeaderProps {
  readonly ticket: TicketDetailResponse;
  readonly sla: SlaBadge | undefined;
}

/** Where the ticket sits (back to the inbox), its number and title, and its state, SLA and priority at a glance. */
export function TicketDetailHeader({ ticket, sla }: TicketDetailHeaderProps) {
  const { t } = useTranslation('tickets');
  return (
    <header className={styles.header}>
      <nav aria-label={t('detail.breadcrumb')}>
        <ol className={styles.breadcrumb}>
          <li>
            <Link to={paths.tickets}>{t('inbox.title')}</Link>
          </li>
          <li aria-current="page" className="text-code">
            {ticket.number}
          </li>
        </ol>
      </nav>
      <div className={styles.titleRow}>
        <span className={cx('text-code', styles.number)}>{ticket.number}</span>
        <h1 className="text-ticket-title">{ticket.title}</h1>
      </div>
      <div className={styles.badges}>
        <TicketStatusBadge status={ticket.status} />
        {sla !== undefined && <Badge tone={sla.tone}>{slaText(sla)}</Badge>}
        {ticket.priority !== null && <Badge>{t('detail.priority', { name: ticket.priority.name })}</Badge>}
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

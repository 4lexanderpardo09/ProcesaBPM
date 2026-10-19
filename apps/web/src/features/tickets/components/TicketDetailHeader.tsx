import type { TicketDetailResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { cx } from '@/shared/lib/cx';
import { paths } from '@/shared/lib/paths';
import { Badge } from '@/shared/ui';
import styles from './TicketDetailHeader.module.css';
import { TicketStatusBadge } from './TicketStatusBadge';

export interface TicketDetailHeaderProps {
  readonly ticket: TicketDetailResponse;
  readonly overdue: boolean;
}

/** Where the ticket sits (back to the inbox), its number and title, and its state at a glance. */
export function TicketDetailHeader({ ticket, overdue }: TicketDetailHeaderProps) {
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
        {overdue && <Badge tone="danger">{t('detail.overdue')}</Badge>}
      </div>
    </header>
  );
}

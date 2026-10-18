import { useTranslation } from 'react-i18next';
import { Select } from '@/shared/ui';
import { TICKET_STATUSES, type TicketStatus } from '../lib/inbox-params';
import styles from './InboxFilters.module.css';

export interface InboxFiltersProps {
  readonly status: TicketStatus | undefined;
  readonly onStatusChange: (status: TicketStatus | undefined) => void;
}

/** The filters the API supports today: only the status. */
export function InboxFilters({ status, onStatusChange }: InboxFiltersProps) {
  const { t } = useTranslation('tickets');
  const options = TICKET_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }));
  return (
    <div className={styles.filters}>
      <Select
        label={t('filters.status')}
        placeholder={t('filters.anyStatus')}
        options={options}
        value={status ?? ''}
        onChange={(event) => onStatusChange(TICKET_STATUSES.find((value) => value === event.target.value))}
      />
    </div>
  );
}

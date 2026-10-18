import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui';
import type { TicketStatus } from '../lib/inbox-params';
import { TICKET_STATUS_TONE } from '../lib/ticket-status';

export function TicketStatusBadge({ status }: { readonly status: TicketStatus }) {
  const { t } = useTranslation('tickets');
  return <Badge tone={TICKET_STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>;
}

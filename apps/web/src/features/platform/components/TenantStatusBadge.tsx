import type { TenantListItem } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from '@/shared/ui';

const TONES: Readonly<Record<TenantListItem['status'], BadgeTone>> = { ACTIVE: 'ok', SUSPENDED: 'warn', CANCELLED: 'neutral', DELETED: 'danger', PENDING_DELETION: 'danger', PURGED: 'neutral' };

export function TenantStatusBadge({ status }: { readonly status: TenantListItem['status'] }) {
  const { t } = useTranslation('platform');
  return <Badge tone={TONES[status]}>{t(`statuses.${status}`)}</Badge>;
}

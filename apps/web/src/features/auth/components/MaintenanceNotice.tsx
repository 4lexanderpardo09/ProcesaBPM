import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Alert } from '@/shared/ui';
import styles from './MaintenanceNotice.module.css';

const detailsSchema = z.object({ title: z.string(), body: z.string().optional(), endsAt: z.string().nullable() });

/** A platform announcement. Its title and body are plain text written by the platform: never rendered as HTML. */
export function MaintenanceNotice({ details }: { readonly details: unknown }) {
  const { t } = useTranslation('auth');
  const parsed = detailsSchema.safeParse(details);
  const announcement = parsed.success ? parsed.data : { title: '', endsAt: null };
  return (
    <Alert tone="warn" title={announcement.title === '' ? t('maintenance.title') : announcement.title}>
      {announcement.body !== undefined && <p className={styles.body}>{announcement.body}</p>}
      <p>{announcement.endsAt === null ? t('maintenance.noEnd') : t('maintenance.endsAt', { date: formatDateTime(announcement.endsAt) })}</p>
    </Alert>
  );
}

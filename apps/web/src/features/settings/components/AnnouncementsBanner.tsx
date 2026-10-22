import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Alert, Button } from '@/shared/ui';
import { announcementsQueryOptions } from '../api/settings-api';
import styles from './Settings.module.css';

const DISMISSED_KEY = 'procesabpm.dismissedAnnouncements';

function readDismissed(): ReadonlySet<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** The platform's notices in force (maintenance, what is new), above every page; each can be closed for this session. */
export function AnnouncementsBanner() {
  const { t } = useTranslation('settings');
  const announcements = useQuery(announcementsQueryOptions(useApiClient()));
  const [dismissed, setDismissed] = useState(readDismissed);
  const shown = (announcements.data ?? []).filter((announcement) => !dismissed.has(announcement.id));
  if (shown.length === 0) return null;
  const dismiss = (id: string) => {
    const next = new Set([...dismissed, id]);
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    } catch {
      // Without storage the notice just comes back on the next page load.
    }
  };
  return (
    <div className={styles.announcements} role="region" aria-label={t('announcements.label')}>
      {shown.map((announcement) => (
        <Alert key={announcement.id} tone={announcement.type === 'MAINTENANCE' ? 'warn' : 'info'}>
          <div className={styles.announcement}>
            <div>
              <strong>{announcement.title}</strong>
              <p className={styles.announcementBody}>{announcement.body}</p>
            </div>
            <Button variant="ghost" aria-label={t('announcements.dismiss', { title: announcement.title })} onClick={() => dismiss(announcement.id)}>
              ×
            </Button>
          </div>
        </Alert>
      ))}
    </div>
  );
}

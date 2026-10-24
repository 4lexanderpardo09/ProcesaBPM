import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Badge, Button } from '@/shared/ui';
import type { SupportVisit } from './support-visit';
import styles from './SupportVisitBar.module.css';

/** The organization being visited, that it is read-only and until when, in the top bar; and the way out. */
export function SupportVisitTitle({ visit }: { readonly visit: SupportVisit }) {
  const { t } = useTranslation('platform');
  return (
    <div className={styles.title}>
      <span className={styles.name}>{visit.tenant.name}</span>
      <Badge tone="warn">{t('visit.badge')}</Badge>
      <span className={styles.until}>{t('visit.until', { date: formatDateTime(visit.grantExpiresAt()) })}</span>
    </div>
  );
}

export function EndVisitButton({ visit }: { readonly visit: SupportVisit }) {
  const { t } = useTranslation('platform');
  const [closing, setClosing] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={closing}
      onClick={() => {
        setClosing(true);
        void visit.close();
      }}
    >
      {t('visit.end')}
    </Button>
  );
}

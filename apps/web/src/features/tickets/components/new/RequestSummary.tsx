import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui';
import styles from './NewTicket.module.css';

export interface RequestSummaryProps {
  readonly company: string | undefined;
  readonly category: string | undefined;
  readonly subcategory: string | undefined;
  readonly subcategoryDescription: string | null | undefined;
  readonly priority: string | undefined;
  readonly firstStep: string | undefined;
}

/** What the ticket will be, as chosen so far; a dash for what is not chosen yet. */
export function RequestSummary({ company, category, subcategory, subcategoryDescription, priority, firstStep }: RequestSummaryProps) {
  const { t } = useTranslation('tickets');
  const rows: ReadonlyArray<readonly [string, string | undefined]> = [
    [t('new.summary.company'), company],
    [t('new.summary.category'), category],
    [t('new.summary.subcategory'), subcategory],
    [t('new.summary.priority'), priority],
    [t('new.summary.firstStep'), firstStep],
  ];
  return (
    <Card title={t('new.summary.title')}>
      <dl className={styles.summary}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.summaryRow}>
            <dt>{label}</dt>
            <dd>{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
      {subcategoryDescription !== null && subcategoryDescription !== undefined && subcategoryDescription !== '' && <p className={styles.note}>{subcategoryDescription}</p>}
      <p className={styles.note}>{t('new.summary.slaNote')}</p>
    </Card>
  );
}

import { useTranslation } from 'react-i18next';
import { Button } from '../button/Button';
import { pageRange } from './page-range';
import styles from './Pagination.module.css';

export interface PaginationProps {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onChange: (page: number) => void;
}

/** "Showing X–Y of N" with previous and next; the buttons hide when everything fits in one page. */
export function Pagination({ page, pageSize, total, onChange }: PaginationProps) {
  const { t } = useTranslation();
  const range = pageRange(page, pageSize, total);
  return (
    <nav aria-label={t('pagination.label')} className={styles.pagination}>
      <span className={styles.range}>{t('pagination.range', { from: range.from, to: range.to, total })}</span>
      {range.pageCount > 1 && (
        <span className={styles.buttons}>
          <Button variant="secondary" disabled={!range.hasPrevious} onClick={() => onChange(page - 1)}>
            {t('pagination.previous')}
          </Button>
          <Button variant="secondary" disabled={!range.hasNext} onClick={() => onChange(page + 1)}>
            {t('pagination.next')}
          </Button>
        </span>
      )}
    </nav>
  );
}

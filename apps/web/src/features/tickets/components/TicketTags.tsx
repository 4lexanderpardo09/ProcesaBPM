import type { TagResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import styles from './TicketTags.module.css';

const VISIBLE_TAGS = 2;

/** The caller's own tags on a ticket: the first ones by name, then how many more. Each tag keeps the color its owner chose. */
export function TicketTags({ tags }: { readonly tags: readonly TagResponse[] }) {
  const { t } = useTranslation('tickets');
  if (tags.length === 0) return null;
  const visible = tags.slice(0, VISIBLE_TAGS);
  const hidden = tags.slice(VISIBLE_TAGS);
  return (
    <span className={styles.tags}>
      {visible.map((tag) => (
        <span key={tag.id} className={styles.tag}>
          <span className={styles.dot} style={{ backgroundColor: tag.color }} aria-hidden="true" />
          {tag.name}
        </span>
      ))}
      {hidden.length > 0 && (
        <span className={styles.more} title={hidden.map((tag) => tag.name).join(', ')}>
          <span aria-hidden="true">{t('tags.more', { count: hidden.length })}</span>
          <span className={styles.visuallyHidden}>{t('tags.moreLabel', { count: hidden.length, names: hidden.map((tag) => tag.name).join(', ') })}</span>
        </span>
      )}
    </span>
  );
}

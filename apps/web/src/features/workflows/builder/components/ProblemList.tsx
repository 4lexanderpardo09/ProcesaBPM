import { useTranslation } from 'react-i18next';
import { cx } from '@/shared/lib/cx';
import { type ElementProblems, problemText } from '../lib/problems';
import styles from './Builder.module.css';

/** The problems of the selected block or connection, errors first; nothing when there are none. */
export function ProblemList({ problems }: { readonly problems: ElementProblems }) {
  const { t } = useTranslation(['workflowProblems', 'workflows']);
  if (problems.errors.length === 0 && problems.warnings.length === 0) return null;
  return (
    <section className={styles.problemBox} aria-label={t('workflows:builder.inspector.problems')}>
      <h3 className={styles.sectionTitle}>{t('workflows:builder.inspector.problems')}</h3>
      <ul className={styles.problemItems}>
        {[...problems.errors, ...problems.warnings].map((problem, index) => (
          <li key={`${problem.code}-${String(index)}`} className={cx(styles.problemItem, problem.severity === 'error' ? styles.problemError : styles.problemWarning)}>
            {problemText(problem, t)}
          </li>
        ))}
      </ul>
    </section>
  );
}

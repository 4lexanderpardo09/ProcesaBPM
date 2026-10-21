import type { WorkflowProblem, WorkflowValidation } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { cx } from '@/shared/lib/cx';
import { problemTarget, problemText } from '../lib/problems';
import styles from './Builder.module.css';

export interface ProblemsPanelProps {
  readonly validation: WorkflowValidation;
  readonly nameOf: (problem: WorkflowProblem) => string | undefined;
  readonly onGoTo: (problem: WorkflowProblem) => void;
  readonly onClose: () => void;
}

/** Every problem of the draft: errors block publishing, warnings do not. Each one leads to its block or connection. */
export function ProblemsPanel({ validation, nameOf, onGoTo, onClose }: ProblemsPanelProps) {
  const { t } = useTranslation(['workflowProblems', 'workflows']);
  const groups = [
    { key: 'errors', title: t('workflows:builder.panel.errors'), problems: validation.errors, className: styles.problemError },
    { key: 'warnings', title: t('workflows:builder.panel.warnings'), problems: validation.warnings, className: styles.problemWarning },
  ] as const;
  return (
    <section className={styles.panel} aria-label={t('workflows:builder.panel.title')}>
      <header className={styles.panelHeader}>
        <h2 className={styles.sectionTitle}>{t('workflows:builder.panel.title')}</h2>
        <button type="button" className={styles.panelClose} aria-label={t('workflows:builder.panel.close')} onClick={onClose}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div className={styles.panelBody}>
        {validation.errors.length === 0 && validation.warnings.length === 0 && <p className={styles.note}>{t('workflows:builder.panel.none')}</p>}
        {groups.map(
          (group) =>
            group.problems.length > 0 && (
              <div key={group.key}>
                <h3 className={styles.panelGroup}>{group.title}</h3>
                <ul className={styles.problemItems}>
                  {group.problems.map((problem, index) => {
                    const where = nameOf(problem);
                    return (
                      <li key={`${problem.code}-${String(index)}`} className={cx(styles.problemItem, group.className)}>
                        {problemTarget(problem) === null ? (
                          <span>
                            <strong>{where ?? t('workflows:builder.panel.general')}: </strong>
                            {problemText(problem, t)}
                          </span>
                        ) : (
                          <button type="button" className={styles.problemLink} onClick={() => onGoTo(problem)}>
                            <strong>{where ?? t('workflows:builder.panel.general')}: </strong>
                            {problemText(problem, t)}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ),
        )}
      </div>
    </section>
  );
}

import { useTranslation } from 'react-i18next';
import type { DesignProblem } from '../../lib/design-problems';

/** One problem in Spanish; a draft-only one says it will matter when the draft is published. */
export function ProblemText({ problem }: { readonly problem: DesignProblem }) {
  const { t } = useTranslation('workflows');
  const text = t(`documents.designer.problems.${problem.code}`, { detail: problem.detail });
  return <>{problem.draftOnly ? t('documents.designer.problems.draftOnly', { text }) : text}</>;
}

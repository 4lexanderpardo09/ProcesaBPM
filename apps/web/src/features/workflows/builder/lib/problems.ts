import type { WorkflowProblem, WorkflowValidation } from '@procesabpm/shared';
import type { TFunction } from 'i18next';
import type { Selection } from './builder-doc';

type ProblemKey = keyof typeof import('@/i18n/es/workflow-problems').workflowProblems;

/**
 * The sentence for a problem, with its values filled in: lists are joined, an assignment mode or an operator is named as
 * the inspector names it. A code this screen does not know yet still says something (and which code).
 */
export function problemText(problem: WorkflowProblem, t: TFunction<['workflowProblems', 'workflows']>): string {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(problem.params ?? {})) values[key] = Array.isArray(value) ? value.join(', ') : String(value);
  if (values.mode !== undefined) values.mode = t(`workflows:builder.assignment.modes.${values.mode}` as 'workflows:builder.assignment.modes.CREATOR', { defaultValue: values.mode });
  if (values.operator !== undefined) values.operator = t(`workflows:builder.condition.operators.${values.operator}` as 'workflows:builder.condition.operators.equals', { defaultValue: values.operator });
  if (values.part !== undefined) values.part = t(`workflows:builder.notification.parts.${values.part}` as 'workflows:builder.notification.parts.subject', { defaultValue: values.part });
  const key = problem.code as ProblemKey;
  return t(`workflowProblems:${key}`, { ...values, defaultValue: t('workflowProblems:unknown', { code: problem.code }) });
}

/** Where the problem is on the canvas: its block, else its connection; fields and amount rules point nowhere yet. */
export function problemTarget(problem: WorkflowProblem): Selection {
  if (problem.stepId !== undefined) return { kind: 'step', id: problem.stepId };
  if (problem.transitionId !== undefined) return { kind: 'transition', id: problem.transitionId };
  return null;
}

export interface ElementProblems {
  readonly errors: readonly WorkflowProblem[];
  readonly warnings: readonly WorkflowProblem[];
}

const NONE: ElementProblems = { errors: [], warnings: [] };

/** The problems of each block and connection, to badge them on the canvas and list them in the inspector. */
export function problemsByElement(validation: WorkflowValidation): (id: string) => ElementProblems {
  const map = new Map<string, { errors: WorkflowProblem[]; warnings: WorkflowProblem[] }>();
  const add = (problem: WorkflowProblem) => {
    const id = problem.stepId ?? problem.transitionId;
    if (id === undefined) return;
    const entry = map.get(id) ?? { errors: [], warnings: [] };
    (problem.severity === 'error' ? entry.errors : entry.warnings).push(problem);
    map.set(id, entry);
  };
  validation.errors.forEach(add);
  validation.warnings.forEach(add);
  return (id) => map.get(id) ?? NONE;
}

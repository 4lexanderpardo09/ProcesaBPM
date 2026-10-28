import type { WorkflowVersionDocument } from '../document.js';
import { findEngineSupportProblems } from '../engine-support.js';
import type { WorkflowProblem } from '../problems.js';
import { validateWorkflowGraph } from '../validate-workflow-graph.js';
import type { DraftCatalog, WorkflowDraftSpec } from './spec.js';
import { type SpecProblem, translateDraftSpec } from './translate-spec.js';

export type DraftCheck =
  | { readonly kind: 'untranslatable'; readonly problems: readonly SpecProblem[] }
  | { readonly kind: 'translated'; readonly document: WorkflowVersionDocument; readonly errors: readonly WorkflowProblem[]; readonly warnings: readonly WorkflowProblem[] };

/** Translates a spec and runs the very checks publishing runs, so the model can be told what to fix. */
export function checkDraftSpec(spec: WorkflowDraftSpec, catalog: DraftCatalog): DraftCheck {
  const translation = translateDraftSpec(spec, catalog);
  if (!translation.ok) return { kind: 'untranslatable', problems: translation.problems };
  const validation = validateWorkflowGraph(translation.document);
  return { kind: 'translated', document: translation.document, errors: [...validation.errors, ...findEngineSupportProblems(translation.document)], warnings: validation.warnings };
}

const refOf = (id: string): string => id.replace(/^new:/, '');

function paramsText(params: WorkflowProblem['params']): string {
  if (params === undefined) return '';
  const parts = Object.entries(params).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('; ') : String(value)}`);
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

/** One line per spec problem, in the names the model used. */
export function describeSpecProblems(problems: readonly SpecProblem[], spec: WorkflowDraftSpec): string[] {
  return problems.map((problem) => {
    const where = [
      problem.ref === undefined ? null : `step "${problem.ref}"`,
      problem.amountRule === undefined ? null : `amount rule #${problem.amountRule}`,
      problem.field === undefined ? null : `field ${problem.field}`,
      problem.transition === undefined ? null : describeSpecTransition(spec, problem.transition),
    ].filter((part) => part !== null);
    return `${problem.code}${where.length > 0 ? ` at ${where.join(', ')}` : ''}${paramsText(problem.params)}`;
  });
}

function describeSpecTransition(spec: WorkflowDraftSpec, index: number): string {
  const transition = spec.transitions[index];
  return transition === undefined ? `transition #${index}` : `transition #${index} "${transition.label}" (${transition.from} -> ${transition.to})`;
}

/** One line per validator problem: ids of the translated document are mapped back to refs, codes and labels. */
export function describeWorkflowProblems(problems: readonly WorkflowProblem[], document: WorkflowVersionDocument): string[] {
  const transitions = new Map(document.transitions.map((transition) => [transition.id, transition]));
  const fields = new Map(document.fields.map((field) => [field.id, field]));
  const amountRules = new Map(document.amountRules.map((rule, index) => [rule.id, { rule, index }]));
  return problems.map((problem) => {
    const where: string[] = [];
    if (problem.stepId !== undefined) where.push(`step "${refOf(problem.stepId)}"`);
    if (problem.transitionId !== undefined) {
      const transition = transitions.get(problem.transitionId);
      where.push(transition === undefined ? 'a transition' : `transition "${transition.label}" (${refOf(transition.fromStepId)} -> ${refOf(transition.toStepId)})`);
    }
    if (problem.amountRuleId !== undefined) {
      const found = amountRules.get(problem.amountRuleId);
      where.push(found === undefined ? 'an amount rule' : `amount rule #${found.index} on ${found.rule.fieldCode}`);
    }
    if (problem.fieldId !== undefined) where.push(`field ${fields.get(problem.fieldId)?.code ?? '?'}`);
    return `${problem.code}${where.length > 0 ? ` at ${where.join(', ')}` : ''}${paramsText(problem.params)}`;
  });
}

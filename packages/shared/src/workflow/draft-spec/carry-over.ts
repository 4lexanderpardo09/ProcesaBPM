import type { AmountRuleDocument, FieldDocument, StepDocument, TransitionDocument, WorkflowVersionDocument } from '../document.js';
import { findEngineSupportProblems } from '../engine-support.js';
import type { WorkflowProblem } from '../problems.js';
import { validateWorkflowGraph } from '../validate-workflow-graph.js';
import { type ElementLoss, stableJson } from './document-diff.js';
import type { DraftBasis, DraftSpecLoss } from './spec-from-document.js';
import type { WorkflowDraftSpec } from './spec.js';

export interface CarriedDraft {
  readonly document: WorkflowVersionDocument;
  /** Settings the spec does not show, kept because the model left their element as it was. */
  readonly kept: readonly DraftSpecLoss[];
  /** Settings lost because the model changed or removed their element (or keeping them would break the draft). */
  readonly dropped: readonly DraftSpecLoss[];
}

type Carry = (document: WorkflowVersionDocument) => WorkflowVersionDocument | undefined;

const asLoss = ({ subject, name, properties }: ElementLoss): DraftSpecLoss => ({ subject, name, properties });
const newId = (ref: string) => `new:${ref}`;
const errorsOf = (document: WorkflowVersionDocument): WorkflowProblem[] => [...validateWorkflowGraph(document).errors, ...findEngineSupportProblems(document)];

/**
 * Puts back on a revised draft (`translated`, the translation of the model's spec `after`) the settings of the
 * original draft the spec does not show, on each element the model left exactly as it was in the basis spec. Ids and
 * layout stay those of the translation. An element whose kept settings would add errors the translation does not
 * have (a closing rule that names a field the model removed…) is left as the model wrote it, and its settings dropped.
 */
export function carryOverSettings(basis: DraftBasis, after: WorkflowDraftSpec, translated: WorkflowVersionDocument): CarriedDraft {
  const carries = new Map<string, Carry>();
  const dropped: DraftSpecLoss[] = [];
  const planner = new CarryPlanner(basis, after);
  for (const loss of basis.hidden) {
    const carry = planner.carryFor(loss.element);
    if (carry === undefined) dropped.push(asLoss(loss));
    else carries.set(loss.element, carry);
  }

  // Errors the model's draft or the original already had are not the kept settings' doing.
  const revisedKey = problemKey((id) => id.replace(/^new:/, ''));
  const baseline = new Set([...errorsOf(translated).map((problem) => revisedKey(problem, translated)), ...errorsOf(basis.document).map((problem) => problemKey((id) => basis.refs.get(id) ?? id)(problem, basis.document))]);
  let document = translated;
  // Each pass that finds new errors gives up at least one element, so this ends.
  for (;;) {
    document = [...carries.values()].reduce((current, carry) => carry(current) ?? current, translated);
    const added = errorsOf(document).filter((problem) => !baseline.has(revisedKey(problem, document)));
    if (added.length === 0) break;
    const blamed = [...carries.keys()].filter((element) => added.some((problem) => blames(problem, element, document)));
    // An error no single element explains: keep nothing rather than write a draft worse than the model's.
    for (const element of blamed.length > 0 ? blamed : [...carries.keys()]) carries.delete(element);
  }
  const keptElements = new Set(carries.keys());
  for (const loss of basis.hidden) if (!keptElements.has(loss.element) && planner.carryFor(loss.element) !== undefined) dropped.push(asLoss(loss));
  return { document, kept: basis.hidden.filter((loss) => keptElements.has(loss.element)).map(asLoss), dropped };
}

/** A problem with the ids of the draft it was found in turned into what both drafts share: refs, field codes, labels. */
function problemKey(refOf: (stepId: string) => string) {
  return (problem: WorkflowProblem, document: WorkflowVersionDocument): string => {
    const transition = document.transitions.find((candidate) => candidate.id === problem.transitionId);
    const rule = document.amountRules.find((candidate) => candidate.id === problem.amountRuleId);
    return stableJson({
      code: problem.code,
      step: problem.stepId === undefined ? undefined : refOf(problem.stepId),
      field: document.fields.find((field) => field.id === problem.fieldId)?.code,
      transition: transition === undefined ? undefined : [refOf(transition.fromStepId), refOf(transition.toStepId), transition.label],
      rule: rule === undefined ? undefined : [rule.fieldCode, rule.action, rule.maxAmount],
      params: problem.params,
    });
  };
}

/** Whether a problem points at the element (by the ids it has in the revised draft). */
function blames(problem: WorkflowProblem, element: string, document: WorkflowVersionDocument): boolean {
  const [kind, key] = splitElement(element);
  if (kind === 'step') return problem.stepId === newId(key);
  if (kind === 'field') return problem.fieldId !== undefined && document.fields.find((field) => field.id === problem.fieldId)?.code === key;
  if (kind === 'transition') return problem.transitionId !== undefined;
  return problem.amountRuleId !== undefined;
}

function splitElement(element: string): [string, string] {
  const at = element.indexOf(':');
  return [element.slice(0, at), element.slice(at + 1)];
}

/** How each element of the original goes back on the revised draft, when the model left it as it was. */
class CarryPlanner {
  private readonly originalRefs: ReadonlyMap<string, string>;
  private readonly usedTransitions = new Set<number>();
  private readonly usedRules = new Set<number>();
  private readonly transitionCarries = new Map<string, Carry | undefined>();
  private readonly ruleCarries = new Map<string, Carry | undefined>();

  constructor(
    private readonly basis: DraftBasis,
    private readonly after: WorkflowDraftSpec,
  ) {
    this.originalRefs = basis.refs;
  }

  carryFor(element: string): Carry | undefined {
    const [kind, key] = splitElement(element);
    if (kind === 'step') return this.step(key);
    if (kind === 'field') return this.field(key);
    if (kind === 'transition') return this.memo(this.transitionCarries, key, () => this.transition(Number(key)));
    return this.memo(this.ruleCarries, key, () => this.amountRule(Number(key)));
  }

  private memo(cache: Map<string, Carry | undefined>, key: string, build: () => Carry | undefined): Carry | undefined {
    if (!cache.has(key)) cache.set(key, build());
    return cache.get(key);
  }

  /** The id an original step has in the revised draft. */
  private revisedId(stepId: string | null): string | null {
    if (stepId === null) return null;
    const ref = this.originalRefs.get(stepId);
    return ref === undefined ? null : newId(ref);
  }

  private step(ref: string): Carry | undefined {
    const before = this.basis.spec.steps.find((step) => step.ref === ref);
    const now = this.after.steps.find((step) => step.ref === ref);
    const original = this.basis.document.steps.find((step) => this.originalRefs.get(step.id) === ref);
    if (before === undefined || now === undefined || original === undefined || stableJson(before) !== stableJson(now)) return undefined;
    return (document) => replaceIn(document, 'steps', (step: StepDocument) => step.id === newId(ref), (step) => ({ ...original, id: step.id, ui: step.ui, sameAssigneeStepId: this.revisedId(original.sameAssigneeStepId) }));
  }

  private field(code: string): Carry | undefined {
    const before = this.basis.spec.fields.find((field) => field.code === code);
    const now = this.after.fields.find((field) => field.code === code);
    const original = this.basis.document.fields.find((field) => field.code === code);
    if (before === undefined || now === undefined || original === undefined || stableJson(before) !== stableJson(now)) return undefined;
    return (document) => replaceIn(document, 'fields', (field: FieldDocument) => field.code === code, (field) => ({ ...original, id: field.id, stepId: field.stepId, sortOrder: field.sortOrder }));
  }

  /** The n-th transition of the original (by sort order) is the n-th of the basis spec: the extractor keeps them all. */
  private transition(index: number): Carry | undefined {
    const original = [...this.basis.document.transitions].sort((a, b) => a.sortOrder - b.sortOrder)[index];
    const before = this.basis.spec.transitions[index];
    if (original === undefined || before === undefined) return undefined;
    const match = this.after.transitions.findIndex((transition, at) => !this.usedTransitions.has(at) && stableJson(transition) === stableJson(before));
    if (match < 0) return undefined;
    this.usedTransitions.add(match);
    const from = newId(before.from);
    const to = newId(before.to);
    const isIt = (transition: TransitionDocument) => transition.fromStepId === from && transition.toStepId === to && transition.label === before.label;
    return (document) => replaceIn(document, 'transitions', isIt, (transition) => ({ ...original, id: transition.id, fromStepId: from, toStepId: to, sortOrder: transition.sortOrder, uiPoints: transition.uiPoints }));
  }

  /** Amount rules translate one to one and in order: the n-th of the spec is the n-th of its translation. */
  private amountRule(index: number): Carry | undefined {
    const original = this.basis.document.amountRules[index];
    const before = this.basis.spec.amountRules[index];
    if (original === undefined || before === undefined) return undefined;
    const match = this.after.amountRules.findIndex((rule, at) => !this.usedRules.has(at) && stableJson(rule) === stableJson(before));
    if (match < 0) return undefined;
    this.usedRules.add(match);
    return (document) => {
      const rule = document.amountRules[match];
      if (rule === undefined) return undefined;
      const kept: AmountRuleDocument = { ...original, id: rule.id, stepId: rule.stepId, approvalStepId: rule.approvalStepId };
      return { ...document, amountRules: document.amountRules.map((candidate, at) => (at === match ? kept : candidate)) };
    };
  }
}

/** The document with the one element `isIt` finds replaced, or `undefined` when there is none. */
function replaceIn<K extends 'steps' | 'fields' | 'transitions'>(
  document: WorkflowVersionDocument,
  key: K,
  isIt: (element: WorkflowVersionDocument[K][number]) => boolean,
  replace: (element: WorkflowVersionDocument[K][number]) => WorkflowVersionDocument[K][number],
): WorkflowVersionDocument | undefined {
  const list = document[key] as ReadonlyArray<WorkflowVersionDocument[K][number]>;
  const at = list.findIndex(isIt);
  if (at < 0) return undefined;
  return { ...document, [key]: list.map((element, index) => (index === at ? replace(element) : element)) };
}

import { type FieldDocument, type StepDocument, type TransitionDocument, type WorkflowVersionDocument } from '../document.js';
import { WorkflowGraph } from '../graph.js';
import { type ProblemCollector } from '../problems.js';

/** What every rule reads: the document, its graph and the lookups they all need. */
export interface RuleContext {
  readonly doc: WorkflowVersionDocument;
  readonly graph: WorkflowGraph;
  readonly problems: ProblemCollector;
  readonly stepById: ReadonlyMap<string, StepDocument>;
  /** The first field with each code (duplicates are reported by their own rule). */
  readonly fieldByCode: ReadonlyMap<string, FieldDocument>;
  readonly transitionsFrom: ReadonlyMap<string, readonly TransitionDocument[]>;
  readonly reachable: ReadonlySet<string>;
  readonly canFinish: ReadonlySet<string>;
}

export function buildContext(doc: WorkflowVersionDocument, problems: ProblemCollector): RuleContext {
  const graph = new WorkflowGraph(
    doc.steps.map((step) => ({ id: step.id, type: step.type })),
    doc.transitions.map((transition) => ({ from: transition.fromStepId, to: transition.toStepId })),
  );
  const fieldByCode = new Map<string, FieldDocument>();
  for (const field of doc.fields) if (!fieldByCode.has(field.code)) fieldByCode.set(field.code, field);
  const transitionsFrom = new Map<string, TransitionDocument[]>();
  for (const transition of doc.transitions) transitionsFrom.set(transition.fromStepId, [...(transitionsFrom.get(transition.fromStepId) ?? []), transition]);
  return {
    doc,
    graph,
    problems,
    stepById: new Map(doc.steps.map((step) => [step.id, step])),
    fieldByCode,
    transitionsFrom,
    reachable: graph.reachableFromStarts(),
    canFinish: graph.canReachEnd(),
  };
}

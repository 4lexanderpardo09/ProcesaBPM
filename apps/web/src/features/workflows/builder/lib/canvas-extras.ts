import type { StepDocument, WorkflowVersionDocument } from '@procesabpm/shared';
import type { RecordKind } from '../hooks/use-record-names';
import { fromCandidates, fromInitiators } from './participants';

/** What a block carries beyond its type and assignment, shown as small badges on the canvas. */
export type StepBadge =
  | { readonly kind: 'amountRules'; readonly count: number; readonly strongest: 'BLOCK' | 'WARN' | 'EXTRA_APPROVAL' }
  | { readonly kind: 'cutoff' }
  | { readonly kind: 'export' }
  | { readonly kind: 'batch' }
  | { readonly kind: 'files'; readonly count: number };

const STRENGTH = { WARN: 0, EXTRA_APPROVAL: 1, BLOCK: 2 } as const;

/**
 * The badges of a block, as the help desk shows them on its canvas: the active amount caps that apply to it (with the
 * strongest action), a deadline by company cutoff, an export file it waits for, batch processing and support files.
 */
export function stepBadges(doc: WorkflowVersionDocument, step: StepDocument): StepBadge[] {
  const badges: StepBadge[] = [];
  const rules = doc.amountRules.filter((rule) => rule.isActive && rule.stepId === step.id);
  if (rules.length > 0) {
    const strongest = rules.reduce((best, rule) => (STRENGTH[rule.action] > STRENGTH[best] ? rule.action : best), rules[0]!.action);
    badges.push({ kind: 'amountRules', count: rules.length, strongest });
  }
  if (step.deadlineType === 'CUTOFF') badges.push({ kind: 'cutoff' });
  if (typeof step.config.requiredExportId === 'string') badges.push({ kind: 'export' });
  if (step.allowsBatch) badges.push({ kind: 'batch' });
  if (step.files.length > 0) badges.push({ kind: 'files', count: step.files.length });
  return badges;
}

const COLUMN = 240;
const ROW = 120;

/**
 * Places the blocks in columns by how far they are from the start (the longest way that does not loop back), in the
 * order they were reached; what cannot be reached goes in a last column. Returns the new position of every block.
 */
export function layeredPositions(doc: WorkflowVersionDocument): Map<string, { x: number; y: number }> {
  const exits = new Map<string, string[]>();
  for (const transition of doc.transitions) exits.set(transition.fromStepId, [...(exits.get(transition.fromStepId) ?? []), transition.toStepId]);
  const depth = new Map<string, number>();
  const order: string[] = [];
  const starts = doc.steps.filter((step) => step.type === 'START').map((step) => step.id);
  // Depth-first from each start: a block's column is one past the deepest block that reaches it without a cycle.
  const visit = (id: string, level: number, path: Set<string>) => {
    if (path.has(id)) return;
    if (!depth.has(id)) order.push(id);
    if ((depth.get(id) ?? -1) >= level) return;
    depth.set(id, level);
    path.add(id);
    for (const next of exits.get(id) ?? []) visit(next, level + 1, path);
    path.delete(id);
  };
  for (const start of starts) visit(start, 0, new Set());
  const lastColumn = Math.max(-1, ...depth.values()) + 1;
  for (const step of doc.steps) if (!depth.has(step.id)) (depth.set(step.id, lastColumn), order.push(step.id));

  const rows = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of order) {
    const column = depth.get(id)!;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    positions.set(id, { x: column * COLUMN, y: row * ROW });
  }
  return positions;
}

/** Who a block names, by kind, as the canvas shows them: the start's creators, a people step's candidates. */
export interface PeopleGroup {
  readonly kind: RecordKind;
  readonly names: readonly string[];
}

/**
 * The people a block names, grouped by kind in a fixed order (the help desk's start card: departments, companies,
 * positions…). A name not known yet (still loading, or removed) is left out; an empty kind is not shown.
 */
export function peopleOf(step: StepDocument, nameOf: (id: string) => string | undefined): PeopleGroup[] {
  const items = step.type === 'START' ? fromInitiators(step.initiators) : fromCandidates(step.candidates);
  return PEOPLE_ORDER.flatMap((kind) => {
    const names = items.filter((item) => item.kind === kind).flatMap((item) => {
      const name = nameOf(item.id);
      return name === undefined ? [] : [name];
    });
    return names.length === 0 ? [] : [{ kind, names }];
  });
}

const PEOPLE_ORDER: readonly RecordKind[] = ['DEPARTMENT', 'COMPANY', 'SITE', 'POSITION', 'GROUP', 'USER'];

/** Every person and record the blocks name, so their names can be asked once for the whole canvas. */
export function namedRecords(doc: WorkflowVersionDocument): { readonly kinds: ReadonlySet<RecordKind>; readonly userIds: readonly string[] } {
  const items = doc.steps.flatMap((step) => (step.type === 'START' ? fromInitiators(step.initiators) : fromCandidates(step.candidates)));
  return { kinds: new Set(items.map((item) => item.kind)), userIds: items.filter((item) => item.kind === 'USER').map((item) => item.id) };
}

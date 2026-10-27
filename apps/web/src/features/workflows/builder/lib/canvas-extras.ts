import type { StepDocument, WorkflowVersionDocument } from '@procesabpm/shared';
import { layeredLayout } from '@/shared/lib/flow-layout';
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

/** The size a block is laid out at: the card's width, and its height with a row of badges (taller cards still fit the gap). */
const BLOCK_WIDTH = 180;
const BLOCK_HEIGHT = 96;

/**
 * Where «Ordenar» puts the blocks: left to right in layers with as few crossings as possible (see `layeredLayout`),
 * so a flow with several starts, closing branches and loops reads like the help desk's. Answers every block's position.
 */
export function layeredPositions(doc: WorkflowVersionDocument): Map<string, { x: number; y: number }> {
  return layeredLayout(
    doc.steps.map((step) => ({ id: step.id, width: BLOCK_WIDTH, height: BLOCK_HEIGHT })),
    doc.transitions.map((transition) => ({ id: transition.id, from: transition.fromStepId, to: transition.toStepId })),
  );
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

import { parseBlockConfig } from '../block-config.js';
import type { FieldDocument, StepDocument, TransitionDocument, WorkflowVersionDocument } from '../document.js';
import { parseFieldConfig } from '../field-config.js';
import { plainTextOf } from './rich-text.js';
import type { DraftSpecLoss } from './spec-from-document.js';

/**
 * A loss tied to the element it is about: `step:<ref>`, `field:<code>`, `transition:<n>` or `amountRule:<n>` (n: its
 * place among the original's, by sort order), so a revision can tell whether the model left that element as it was.
 */
export interface ElementLoss extends DraftSpecLoss {
  readonly element: string;
}

type View = Record<string, unknown>;

/** The engine filters by site only the holders of a position (POSITION, and the positions of a POOL); elsewhere the scope does nothing. */
const SITE_SCOPED_MODES: ReadonlySet<string> = new Set(['POSITION', 'POOL', 'RANDOM_DISPATCH']);
type RefOf = (stepId: string | null) => string | null;

/** JSON with object keys sorted: a jsonb column does not keep the key order it was written with. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Rich text as the spec reads it (paragraphs of plain text), or a marker that cannot match when it has formatting. */
const textView = (html: string | null): string | null => {
  const plain = plainTextOf(html);
  return plain === undefined ? `\u0000rich:${html}` : plain;
};

function differingKeys(a: View, b: View): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => stableJson(a[key]) !== stableJson(b[key]));
}

/** `config` spread as `config.<key>`, so a loss names the setting; defaults applied when it is valid. */
function configView(config: Record<string, unknown>, normalized: Record<string, unknown> | undefined, textKeys: readonly string[] = []): View {
  const source = normalized ?? config;
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [`config.${key}`, textKeys.includes(key) && typeof value === 'string' ? textView(value) : value]));
}

const withoutIds = <T extends { id: string }>(rows: readonly T[]): Array<Omit<T, 'id'>> => rows.map(({ id: _id, ...rest }) => rest);
const sortedRows = (rows: readonly object[]): string[] => rows.map(stableJson).sort();

function stepView(step: StepDocument, refOf: RefOf): View {
  const { id: _id, ui: _ui, description, sameAssigneeStepId, config, candidates, initiators, signers, ...rest } = step;
  const parsed = parseBlockConfig(step.type, config);
  return {
    ...rest,
    siteScope: SITE_SCOPED_MODES.has(step.assignmentMode) ? step.siteScope : null,
    description: textView(description),
    sameAssigneeStepId: refOf(sameAssigneeStepId),
    candidates: sortedRows(withoutIds(candidates)),
    initiators: sortedRows(withoutIds(initiators)),
    signers: [...signers].sort((a, b) => a.sortOrder - b.sortOrder).map(({ id: _signerId, sortOrder: _order, ...signer }) => signer),
    ...configView(config, parsed.valid ? parsed.config : undefined, step.type === 'NOTIFICATION' ? ['body'] : []),
  };
}

function transitionView(transition: TransitionDocument, refOf: RefOf): View {
  return { fromStepId: refOf(transition.fromStepId), toStepId: refOf(transition.toStepId), type: transition.type, label: transition.label, condition: transition.condition, requiresComment: transition.requiresComment };
}

/** A field's place among the fields of its step (sort orders may have gaps; only the order matters). */
function ranks(fields: readonly FieldDocument[]): Map<string, number> {
  const byStep = new Map<string, FieldDocument[]>();
  for (const field of fields) byStep.set(field.stepId, [...(byStep.get(field.stepId) ?? []), field]);
  const rank = new Map<string, number>();
  for (const list of byStep.values()) [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)).forEach((field, index) => rank.set(field.id, index));
  return rank;
}

function fieldView(field: FieldDocument, refOf: RefOf, rank: number | undefined): View {
  const { id: _id, stepId, sortOrder: _order, config, ...rest } = field;
  const parsed = parseFieldConfig(field.type, config, field.dataSource);
  return { ...rest, stepId: refOf(stepId), rank, ...configView(config, parsed.valid ? parsed.config : undefined) };
}

const bySortOrder = <T extends { sortOrder: number }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => a.sortOrder - b.sortOrder);

/**
 * What changes when `original` is rewritten as `translated` (the translation of its spec): ids, block positions,
 * edge bends and the numbering of sort orders are ignored. Steps pair by ref, transitions and amount rules by their
 * order, fields by code. An edge the translator adds (the one an extra approval needs) is not a loss.
 */
export function compareDocuments(original: WorkflowVersionDocument, translated: WorkflowVersionDocument, refs: ReadonlyMap<string, string>): ElementLoss[] {
  const losses: ElementLoss[] = [];
  const originalRef: RefOf = (id) => (id === null ? null : (refs.get(id) ?? `\u0000${id}`));
  const translatedRef: RefOf = (id) => (id === null ? null : id.replace(/^new:/, ''));
  const stepNames = new Map(original.steps.map((step) => [step.id, step.name]));
  const add = (element: string, subject: DraftSpecLoss['subject'], name: string, properties: string[]) => {
    if (properties.length > 0) losses.push({ element, subject, name, properties });
  };

  const translatedSteps = new Map(translated.steps.map((step) => [translatedRef(step.id), step]));
  for (const step of original.steps) {
    const other = translatedSteps.get(refs.get(step.id) ?? '');
    add(`step:${refs.get(step.id) ?? ''}`, 'STEP', step.name, other === undefined ? ['removed'] : differingKeys(stepView(step, originalRef), stepView(other, translatedRef)));
  }

  const translatedTransitions = bySortOrder(translated.transitions);
  bySortOrder(original.transitions).forEach((transition, index) => {
    const other = translatedTransitions[index];
    const name = `${stepNames.get(transition.fromStepId) ?? ''}: ${transition.label}`;
    add(`transition:${index}`, 'TRANSITION', name, other === undefined ? ['removed'] : differingKeys(transitionView(transition, originalRef), transitionView(other, translatedRef)));
  });

  const originalRanks = ranks(original.fields);
  const translatedRanks = ranks(translated.fields);
  const translatedFields = new Map(translated.fields.map((field) => [field.code, field]));
  for (const field of original.fields) {
    const other = translatedFields.get(field.code);
    add(`field:${field.code}`, 'FIELD', field.label, other === undefined ? ['removed'] : differingKeys(fieldView(field, originalRef, originalRanks.get(field.id)), fieldView(other, translatedRef, translatedRanks.get(other.id))));
  }

  original.amountRules.forEach((rule, index) => {
    const other = translated.amountRules[index];
    const view = (row: typeof rule, refOf: RefOf): View => {
      const { id: _id, stepId, approvalStepId, maxAmount, ...rest } = row;
      return { ...rest, stepId: refOf(stepId), approvalStepId: refOf(approvalStepId), maxAmount: Number(maxAmount).toFixed(2) };
    };
    add(`amountRule:${index}`, 'AMOUNT_RULE', rule.fieldCode, other === undefined ? ['removed'] : differingKeys(view(rule, originalRef), view(other, translatedRef)));
  });
  return losses;
}

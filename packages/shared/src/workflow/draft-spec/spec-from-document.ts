import type { AmountRuleDocument, FieldDocument, SignerDocument, StepDocument, TransitionDocument, WorkflowVersionDocument } from '../document.js';
import { parseFieldConfig } from '../field-config.js';
import { compareDocuments, type ElementLoss } from './document-diff.js';
import { plainTextApproximation, plainTextOf } from './rich-text.js';
import {
  DRAFT_COLUMN_TYPES,
  DRAFT_FIELD_TYPES,
  DRAFT_REF_PATTERN,
  DRAFT_STEP_TYPES,
  type DraftAmountRule,
  type DraftAssignment,
  type DraftCatalog,
  type DraftCatalogEntry,
  type DraftField,
  type DraftStep,
  type DraftTransition,
  type WorkflowDraftSpec,
  workflowDraftSpecSchema,
} from './spec.js';
import { normalizeName, type SpecProblem, translateDraftSpec } from './translate-spec.js';

/** What part of a draft a loss is about. */
export const DRAFT_LOSS_SUBJECTS = ['STEP', 'TRANSITION', 'FIELD', 'AMOUNT_RULE'] as const;
export type DraftLossSubject = (typeof DRAFT_LOSS_SUBJECTS)[number];

/**
 * Something of the draft the spec cannot carry: rewriting the draft from the spec would drop or change it. `name` is
 * what the person sees (step name, transition label, field label); `properties` the document properties affected
 * (`config.<key>` for a block or field setting), or `incomplete` when the draft lacks what the spec requires.
 */
export interface DraftSpecLoss {
  readonly subject: DraftLossSubject;
  readonly name: string;
  readonly properties: readonly string[];
}

/**
 * The draft a revision starts from: the document as stored, the ref of each of its steps, its spec, and the settings
 * the spec does not show (each tied to its element), which a revision keeps on the elements the model leaves as they are.
 */
export interface DraftBasis {
  readonly document: WorkflowVersionDocument;
  readonly refs: ReadonlyMap<string, string>;
  readonly spec: WorkflowDraftSpec;
  readonly hidden: readonly ElementLoss[];
}

export type DraftSpecExtraction =
  | { readonly kind: 'spec'; readonly spec: WorkflowDraftSpec; readonly basis: DraftBasis }
  /** No blocks at all: there is nothing to revise. */
  | { readonly kind: 'empty' }
  /** Elements the spec cannot hold at all (a block type it has no words for, a record the organization no longer offers…). */
  | { readonly kind: 'lossy'; readonly losses: readonly DraftSpecLoss[] };

export const INCOMPLETE_PROPERTY = 'incomplete';
const REMOVED_PROPERTY = 'removed';
const MAX_REF_LENGTH = 41;
const PEOPLE_TYPES: ReadonlySet<string> = new Set(['TASK', 'APPROVAL', 'SIGNATURE']);

/**
 * The spec of an existing draft (to revise it with «Crear con IA»): refs derived from the step names, catalog names
 * instead of ids. Translating it back must give every element of the draft; what it gives differently (apart from ids,
 * layout and how sort orders are numbered) is a setting the spec does not show, kept in the basis so `carryOverSettings`
 * puts it back on the elements the model leaves as they are. An element the spec cannot hold at all is a loss, and
 * the draft cannot be revised: a revision never silently drops what the spec cannot express.
 */
export function extractDraftSpec(document: WorkflowVersionDocument, catalog: DraftCatalog): DraftSpecExtraction {
  if (document.steps.length === 0) return { kind: 'empty' };
  const extractor = new Extractor(document, catalog);
  const spec = extractor.run();
  if (extractor.losses.size > 0) return { kind: 'lossy', losses: extractor.lossList() };

  const parsed = workflowDraftSpecSchema.safeParse(spec);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) extractor.lossAtSpecPath(spec, issue.path);
    return { kind: 'lossy', losses: extractor.lossList() };
  }
  const translation = translateDraftSpec(parsed.data, catalog);
  if (!translation.ok) {
    for (const problem of translation.problems) extractor.lossOfProblem(parsed.data, problem);
    return { kind: 'lossy', losses: extractor.lossList() };
  }
  const hidden = compareDocuments(document, translation.document, extractor.refs);
  if (hidden.some((loss) => loss.properties.includes(REMOVED_PROPERTY))) {
    for (const loss of hidden) extractor.loss(loss.subject, loss.name, loss.properties);
    return { kind: 'lossy', losses: extractor.lossList() };
  }
  return { kind: 'spec', spec: parsed.data, basis: { document, refs: extractor.refs, spec: parsed.data, hidden } };
}

/** A ref per step from its name (`Aprobación del jefe` → `aprobacion_del_jefe`), unique in the draft. */
export function refsFromStepNames(steps: readonly Pick<StepDocument, 'id' | 'name'>[]): Map<string, string> {
  const used = new Set<string>();
  const refs = new Map<string, string>();
  for (const step of steps) {
    let base = normalizeName(step.name).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!/^[a-z]/.test(base)) base = `paso_${base}`.replace(/_+$/, '');
    base = base.slice(0, MAX_REF_LENGTH).replace(/_+$/, '');
    let ref = base;
    for (let n = 2; used.has(ref) || !DRAFT_REF_PATTERN.test(ref); n += 1) ref = `${base.slice(0, MAX_REF_LENGTH - `_${n}`.length)}_${n}`;
    used.add(ref);
    refs.set(step.id, ref);
  }
  return refs;
}

class Names {
  private readonly byId: Map<string, string>;

  constructor(entries: readonly DraftCatalogEntry[]) {
    this.byId = new Map(entries.map((entry) => [entry.id, entry.name]));
  }

  of(id: string | null): string | undefined {
    return id === null ? undefined : this.byId.get(id);
  }
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const labelsOf = (options: unknown): string[] | null => (Array.isArray(options) ? options.map((option) => String(asRecord(option).label ?? '')) : null);

class Extractor {
  readonly losses = new Map<string, { subject: DraftLossSubject; name: string; properties: Set<string> }>();
  readonly refs: Map<string, string>;
  private readonly positions: Names;
  private readonly groups: Names;
  private readonly approvalTypes: Names;
  private readonly steps: readonly StepDocument[];

  constructor(
    private readonly document: WorkflowVersionDocument,
    catalog: DraftCatalog,
  ) {
    this.positions = new Names(catalog.positions);
    this.groups = new Names(catalog.groups);
    this.approvalTypes = new Names(catalog.approvalTypes);
    const known = document.steps.filter((step) => {
      if ((DRAFT_STEP_TYPES as readonly string[]).includes(step.type)) return true;
      this.loss('STEP', step.name, ['type']);
      return false;
    });
    this.steps = inFlowOrder(known, document.transitions);
    this.refs = refsFromStepNames(this.steps);
  }

  run(): WorkflowDraftSpec {
    const ordered = byStepThenOrder(this.document.fields, this.steps);
    return {
      assumptions: [],
      decisions: [],
      steps: this.steps.map((step) => this.step(step)),
      transitions: [...this.document.transitions].sort((a, b) => a.sortOrder - b.sortOrder).flatMap((transition) => this.transition(transition)),
      fields: ordered.flatMap((field) => this.field(field)),
      initiators: this.initiators(),
      amountRules: this.document.amountRules.flatMap((rule) => this.amountRule(rule)),
    };
  }

  loss(subject: DraftLossSubject, name: string, properties: readonly string[]): void {
    const key = `${subject}\u0000${name}`;
    const entry = this.losses.get(key) ?? { subject, name, properties: new Set<string>() };
    for (const property of properties) entry.properties.add(property);
    this.losses.set(key, entry);
  }

  lossList(): DraftSpecLoss[] {
    return [...this.losses.values()].map((entry) => ({ subject: entry.subject, name: entry.name, properties: [...entry.properties] }));
  }

  /** A value the spec schema bounds (a longer name, too many blocks): `steps.3.instructions` → that step, `instructions`. */
  lossAtSpecPath(spec: WorkflowDraftSpec, path: readonly PropertyKey[]): void {
    const [collection, index, property] = path;
    const at = typeof index === 'number' ? index : -1;
    const what = typeof property === 'string' ? property : 'count';
    if (collection === 'steps') this.loss('STEP', spec.steps[at]?.name ?? '', [what]);
    else if (collection === 'transitions') this.loss('TRANSITION', spec.transitions[at]?.label ?? '', [what]);
    else if (collection === 'fields') this.loss('FIELD', spec.fields[at]?.label ?? '', [what]);
    else if (collection === 'amountRules') this.loss('AMOUNT_RULE', spec.amountRules[at]?.field ?? '', [what]);
    else this.loss('STEP', '', [String(collection ?? 'count')]);
  }

  /** The draft lacks what the spec needs (a person's step without assignee, a list without options…). */
  lossOfProblem(spec: WorkflowDraftSpec, problem: SpecProblem): void {
    if (problem.ref !== undefined) this.loss('STEP', spec.steps.find((step) => step.ref === problem.ref)?.name ?? problem.ref, [INCOMPLETE_PROPERTY]);
    else if (problem.transition !== undefined) this.loss('TRANSITION', spec.transitions[problem.transition]?.label ?? '', [INCOMPLETE_PROPERTY]);
    else if (problem.amountRule !== undefined) this.loss('AMOUNT_RULE', problem.field ?? '', [INCOMPLETE_PROPERTY]);
    else if (problem.field !== undefined) this.loss('FIELD', spec.fields.find((field) => field.code === problem.field)?.label ?? problem.field, [INCOMPLETE_PROPERTY]);
    else this.loss('STEP', '', [INCOMPLETE_PROPERTY]);
  }

  private refOf(stepId: string | null): string | null {
    return stepId === null ? null : (this.refs.get(stepId) ?? null);
  }

  private nameOrLoss(names: Names, id: string | null, subject: DraftLossSubject, owner: string, property: string): string | null {
    if (id === null) return null;
    const name = names.of(id);
    if (name === undefined) this.loss(subject, owner, [property]);
    return name ?? null;
  }

  private step(step: StepDocument): DraftStep {
    const config = asRecord(step.config);
    const instructions = readableText(step.description);
    return {
      ref: this.refs.get(step.id)!,
      type: step.type as DraftStep['type'],
      name: step.name,
      instructions,
      assignment: PEOPLE_TYPES.has(step.type) ? this.assignment(step) : null,
      sla: step.slaValue === null || step.slaUnit === null ? null : { value: step.slaValue, unit: step.slaUnit },
      maxLoops: step.maxLoops,
      notification: step.type === 'NOTIFICATION' ? this.notification(step, config) : null,
      wait: step.type === 'WAIT' ? this.wait(step, config) : null,
      signatureDocument: step.type === 'SIGNATURE' ? ((config.document as DraftStep['signatureDocument']) ?? null) : null,
    };
  }

  private notification(step: StepDocument, config: Record<string, unknown>): DraftStep['notification'] {
    const body = readableText(typeof config.body === 'string' ? config.body : null);
    const recipients = asArray(config.recipients).map((raw) => {
      const recipient = asRecord(raw);
      const kind = String(recipient.kind);
      const id = typeof recipient.id === 'string' ? recipient.id : null;
      if (kind === 'POSITION') return { kind, name: this.nameOrLoss(this.positions, id, 'STEP', step.name, 'config.recipients') } as const;
      if (kind === 'GROUP') return { kind, name: this.nameOrLoss(this.groups, id, 'STEP', step.name, 'config.recipients') } as const;
      if (kind !== 'CREATOR' && kind !== 'ASSIGNEES' && kind !== 'OBSERVERS') this.loss('STEP', step.name, ['config.recipients']);
      return { kind: kind as 'CREATOR', name: null };
    });
    return { recipients, subject: String(config.subject ?? ''), body: body ?? '' };
  }

  private wait(step: StepDocument, config: Record<string, unknown>): DraftStep['wait'] {
    if (config.mode !== 'DURATION') {
      this.loss('STEP', step.name, ['config.mode']);
      return null;
    }
    return { value: Number(config.value), unit: config.unit as 'BUSINESS_DAYS' };
  }

  private assignment(step: StepDocument): DraftAssignment | null {
    const base: DraftAssignment = {
      mode: 'CREATOR',
      position: null,
      group: null,
      approvalType: this.nameOrLoss(this.approvalTypes, step.approvalGroupTypeId, 'STEP', step.name, 'approvalGroupTypeId'),
      approvalLevel: step.approvalLevel,
      poolPositions: [],
      poolGroups: [],
      sameAsStep: null,
      signers: step.signers.length === 0 ? [] : this.signers(step),
    };
    switch (step.assignmentMode) {
      case 'NONE':
        return null;
      case 'POSITION':
        return { ...base, mode: 'POSITION', position: this.nameOrLoss(this.positions, step.positionId, 'STEP', step.name, 'positionId') };
      case 'GROUP':
      case 'POOL':
        return step.assignmentMode === 'GROUP' ? this.group(step, base) : { ...base, mode: 'POOL', poolPositions: this.candidateNames(step, 'POSITION'), poolGroups: this.candidateNames(step, 'GROUP') };
      case 'APPROVER':
      case 'CREATOR':
        return { ...base, mode: step.assignmentMode };
      case 'SAME_AS_STEP':
        return { ...base, mode: 'SAME_AS_STEP', sameAsStep: this.refOf(step.sameAssigneeStepId) };
      case 'PARALLEL':
        return { ...base, mode: 'PARALLEL_APPROVALS' };
      default:
        this.loss('STEP', step.name, ['assignmentMode']);
        return null;
    }
  }

  private group(step: StepDocument, base: DraftAssignment): DraftAssignment {
    const candidate = step.candidates.find((entry) => entry.participantType === 'GROUP');
    return { ...base, mode: 'GROUP', group: this.nameOrLoss(this.groups, candidate?.groupId ?? null, 'STEP', step.name, 'candidates') };
  }

  private candidateNames(step: StepDocument, type: 'POSITION' | 'GROUP'): string[] {
    const names = type === 'POSITION' ? this.positions : this.groups;
    return step.candidates
      .filter((candidate) => candidate.participantType === type)
      .map((candidate) => this.nameOrLoss(names, type === 'POSITION' ? candidate.positionId : candidate.groupId, 'STEP', step.name, 'candidates'))
      .filter((name): name is string => name !== null);
  }

  private signers(step: StepDocument): DraftAssignment['signers'] {
    return [...step.signers]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .flatMap((signer: SignerDocument): DraftAssignment['signers'] => {
        if (signer.signerType === 'APPROVER' || signer.signerType === 'CREATOR') return [{ kind: signer.signerType, position: null }];
        if (signer.signerType === 'POSITION') return [{ kind: 'POSITION' as const, position: this.nameOrLoss(this.positions, signer.positionId, 'STEP', step.name, 'signers') }];
        this.loss('STEP', step.name, ['signers']);
        return [];
      });
  }

  private transition(transition: TransitionDocument): DraftTransition[] {
    const from = this.refOf(transition.fromStepId);
    const to = this.refOf(transition.toStepId);
    if (from === null || to === null) return [];
    const fromStep = this.steps.find((step) => step.id === transition.fromStepId);
    return [
      {
        from,
        to,
        label: transition.label,
        condition: transition.type === 'CONDITION' && transition.condition !== null ? transition.condition.map((rule) => ({ field: rule.field, op: rule.op, value: rule.value })) : null,
        requiresComment: transition.requiresComment,
        whenRejected: transition.type === 'SYSTEM_ONLY' && fromStep?.assignmentMode === 'PARALLEL',
      },
    ];
  }

  private field(field: FieldDocument): DraftField[] {
    const step = this.refOf(field.stepId);
    if (step === null) return [];
    if (!(DRAFT_FIELD_TYPES as readonly string[]).includes(field.type)) {
      this.loss('FIELD', field.label, ['type']);
      return [];
    }
    const parsed = parseFieldConfig(field.type, field.config, field.dataSource);
    const config = parsed.valid ? parsed.config : asRecord(field.config);
    return [
      {
        step,
        code: field.code,
        label: field.label,
        type: field.type as DraftField['type'],
        required: field.isRequired,
        options: field.type === 'SELECT' || field.type === 'MULTI_SELECT' ? labelsOf(config.options) : null,
        formula: field.type === 'FORMULA' ? { expression: String(config.expression ?? ''), resultType: config.resultType as 'NUMBER' } : null,
        columns: field.type === 'TABLE' ? this.columns(field, config) : null,
      },
    ];
  }

  private columns(field: FieldDocument, config: Record<string, unknown>): DraftField['columns'] {
    return asArray(config.columns).map((raw) => {
      const column = asRecord(raw);
      const type = String(column.type);
      if (!(DRAFT_COLUMN_TYPES as readonly string[]).includes(type)) this.loss('FIELD', field.label, ['config.columns']);
      return {
        code: String(column.code ?? ''),
        label: String(column.label ?? ''),
        type: type as 'TEXT',
        required: column.required === true,
        options: type === 'SELECT' ? labelsOf(column.options) : null,
        expression: typeof column.expression === 'string' ? column.expression : null,
        showTotal: column.showTotal === true,
      };
    });
  }

  /** Who may create tickets lives on START; the spec has one list for it. */
  private initiators(): WorkflowDraftSpec['initiators'] {
    const start = this.steps.find((step) => step.type === 'START');
    if (start === undefined) return [];
    return start.initiators.flatMap((initiator): WorkflowDraftSpec['initiators'] => {
      if (initiator.participantType === 'POSITION') return [{ kind: 'POSITION' as const, name: this.nameOrLoss(this.positions, initiator.positionId, 'STEP', start.name, 'initiators') ?? '' }];
      if (initiator.participantType === 'GROUP') return [{ kind: 'GROUP' as const, name: this.nameOrLoss(this.groups, initiator.groupId, 'STEP', start.name, 'initiators') ?? '' }];
      this.loss('STEP', start.name, ['initiators']);
      return [];
    });
  }

  private amountRule(rule: AmountRuleDocument): DraftAmountRule[] {
    const maxAmount = Number(rule.maxAmount);
    return [
      {
        field: rule.fieldCode,
        amountColumn: rule.amountColumn,
        step: this.refOf(rule.stepId),
        maxAmount,
        currency: rule.currencyCode,
        action: rule.action,
        approvalStep: this.refOf(rule.approvalStepId),
        position: this.nameOrLoss(this.positions, rule.positionId, 'AMOUNT_RULE', rule.fieldCode, 'positionId'),
        message: rule.message,
      },
    ];
  }
}

/** Rich text as the model reads it: its formatting, which the spec has no words for, is a hidden setting of the block. */
function readableText(html: string | null): string | null {
  if (html === null) return null;
  const plain = plainTextOf(html);
  return plain === undefined ? plainTextApproximation(html) : plain;
}

/** START first, then each block by its distance from it (as the flow reads), the unreachable ones last: a stable order. */
function inFlowOrder(steps: readonly StepDocument[], transitions: readonly TransitionDocument[]): StepDocument[] {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const exits = [...transitions].sort((a, b) => a.sortOrder - b.sortOrder);
  const ordered: StepDocument[] = [];
  const seen = new Set<string>();
  const queue = steps.filter((step) => step.type === 'START');
  for (const step of queue) seen.add(step.id);
  while (queue.length > 0) {
    const step = queue.shift()!;
    ordered.push(step);
    for (const transition of exits.filter((candidate) => candidate.fromStepId === step.id)) {
      const next = byId.get(transition.toStepId);
      if (next === undefined || seen.has(next.id)) continue;
      seen.add(next.id);
      queue.push(next);
    }
  }
  return [...ordered, ...steps.filter((step) => !seen.has(step.id))];
}

/** Fields in the order of their steps, then their own order: the translator numbers them the same way. */
function byStepThenOrder(fields: readonly FieldDocument[], steps: readonly StepDocument[]): FieldDocument[] {
  const stepIndex = new Map(steps.map((step, index) => [step.id, index]));
  return [...fields].sort((a, b) => (stepIndex.get(a.stepId) ?? 0) - (stepIndex.get(b.stepId) ?? 0) || a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

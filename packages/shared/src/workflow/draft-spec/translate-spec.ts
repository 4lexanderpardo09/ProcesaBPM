import { parseBlockConfig } from '../block-config.js';
import { FIELD_CODE_PATTERN, isAutomaticStep, type StepType, type TransitionType } from '../constants.js';
import type { AmountRuleDocument, CandidateDocument, FieldDocument, InitiatorDocument, SignerDocument, StepDocument, TransitionDocument, WorkflowVersionDocument } from '../document.js';
import { parseFieldConfig } from '../field-config.js';
import {
  DRAFT_REF_PATTERN,
  type DraftAmountRule,
  type DraftAssignment,
  type DraftCatalog,
  type DraftCatalogEntry,
  type DraftField,
  type DraftStep,
  type DraftTransition,
  type WorkflowDraftSpec,
} from './spec.js';

/** A problem of the spec itself, located by the names the model used (never by ids). */
export interface SpecProblem {
  readonly code: string;
  readonly ref?: string;
  readonly field?: string;
  readonly transition?: number;
  readonly amountRule?: number;
  readonly params?: Readonly<Record<string, string | number | readonly string[]>>;
}

export type DraftTranslation = { readonly ok: true; readonly document: WorkflowVersionDocument } | { readonly ok: false; readonly problems: readonly SpecProblem[] };

const COLUMN_GAP = 260;
const ROW_GAP = 140;
const PEOPLE_DRAFT_TYPES: ReadonlySet<StepType> = new Set(['TASK', 'APPROVAL', 'SIGNATURE']);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const FIELD_STEP_TYPES: ReadonlySet<StepType> = new Set(['START', 'TASK', 'APPROVAL']);
const NUMERIC_COLUMNS: ReadonlySet<string> = new Set(['NUMBER', 'CURRENCY', 'FORMULA']);

export const stepIdOf = (ref: string): string => `new:${ref}`;
export const transitionIdOf = (index: number): string => `new:t${index}`;
export const fieldIdOf = (index: number): string => `new:f${index}`;
export const amountRuleIdOf = (index: number): string => `new:a${index}`;

/** Names compare without accents, case or extra spaces: «Jefe de Bodega» finds «jefe de bodega». */
export function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain text from the model, its paragraphs separated by one blank line: how a NOTIFICATION body is kept. */
export function plainParagraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .join('\n\n');
}

/** Plain text from the model as paragraphs of rich text (the API sanitizes it again). */
export function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

class Lookup {
  private readonly byName: Map<string, string>;

  constructor(entries: readonly DraftCatalogEntry[]) {
    this.byName = new Map(entries.map((entry) => [normalizeName(entry.name), entry.id]));
  }

  find(name: string | null): string | undefined {
    return name === null ? undefined : this.byName.get(normalizeName(name));
  }

  get onlyOne(): string | undefined {
    return this.byName.size === 1 ? [...this.byName.values()][0] : undefined;
  }
}

/** Turns a spec into a version document with `new:` ids, or says what in the spec cannot be turned. */
export function translateDraftSpec(spec: WorkflowDraftSpec, catalog: DraftCatalog): DraftTranslation {
  return new Translator(spec, catalog).run();
}

class Translator {
  private readonly problems: SpecProblem[] = [];
  private readonly positions: Lookup;
  private readonly groups: Lookup;
  private readonly approvalTypes: Lookup;
  private readonly stepsByRef = new Map<string, DraftStep>();
  private idCounter = 0;

  constructor(
    private readonly spec: WorkflowDraftSpec,
    catalog: DraftCatalog,
  ) {
    this.positions = new Lookup(catalog.positions);
    this.groups = new Lookup(catalog.groups);
    this.approvalTypes = new Lookup(catalog.approvalTypes);
  }

  run(): DraftTranslation {
    for (const step of this.spec.steps) {
      if (!DRAFT_REF_PATTERN.test(step.ref)) this.problem('SPEC_REF_INVALID', { ref: step.ref });
      else if (this.stepsByRef.has(step.ref)) this.problem('SPEC_DUPLICATE_REF', { ref: step.ref });
      else this.stepsByRef.set(step.ref, step);
    }
    const diversions = this.diversionPairs();
    const transitions = [...this.spec.transitions.map((transition, index) => this.transition(transition, index, diversions)), ...this.diversionTransitions(diversions)];
    const positions = layeredPositions(this.spec);
    const steps = [...this.stepsByRef.values()].map((step) => this.step(step, positions.get(step.ref) ?? { x: 0, y: 0 }));
    const fields = this.fields();
    const amountRules = this.amountRules();
    const stepsWithInitiators = this.withInitiators(steps.filter((step): step is StepDocument => step !== null));
    if (this.problems.length > 0) return { ok: false, problems: this.problems };
    return {
      ok: true,
      document: {
        steps: stepsWithInitiators,
        transitions: transitions.filter((t): t is TransitionDocument => t !== null),
        fields,
        amountRules,
      },
    };
  }

  private problem(code: string, location: Omit<SpecProblem, 'code'> = {}): void {
    this.problems.push({ code, ...location });
  }

  private childId(prefix: string): string {
    this.idCounter += 1;
    return `new:${prefix}${this.idCounter}`;
  }

  private step(step: DraftStep, ui: { x: number; y: number }): StepDocument | null {
    const automatic = isAutomaticStep(step.type);
    const base: StepDocument = {
      id: stepIdOf(step.ref),
      type: step.type,
      name: step.name,
      description: step.instructions === null || step.instructions.trim() === '' ? null : paragraphs(step.instructions),
      assignmentMode: 'NONE',
      manualSelection: false,
      siteScope: 'ANY_SITE',
      positionId: null,
      approvalGroupTypeId: null,
      approvalLevel: null,
      sameAssigneeStepId: null,
      closeRule: 'NOT_ALLOWED',
      slaValue: automatic || step.sla === null ? null : step.sla.value,
      slaUnit: automatic || step.sla === null ? null : step.sla.unit,
      deadlineType: 'SLA',
      deadlineFieldCode: null,
      deadlineBusinessDays: null,
      maxLoops: step.maxLoops,
      dispatchIntervalMin: null,
      allowsBatch: false,
      config: {},
      ui,
      candidates: [],
      initiators: [],
      slaOverrides: [],
      signers: [],
      files: [],
    };
    const withConfig = { ...base, config: this.blockConfig(step) };
    if (automatic) return withConfig;
    if (!PEOPLE_DRAFT_TYPES.has(step.type)) return withConfig;
    if (step.assignment === null) {
      this.problem('SPEC_ASSIGNMENT_MISSING', { ref: step.ref });
      return null;
    }
    const assigned = { ...withConfig, ...this.assignment(step.ref, step.assignment) };
    return step.type === 'SIGNATURE' ? this.withSignatureSigners(step, assigned) : assigned;
  }

  /** A signature block lists who signs; a parallel one already got its signers from the assignment. */
  private withSignatureSigners(step: DraftStep, assigned: StepDocument): StepDocument {
    const assignment = step.assignment!;
    if (assignment.signers.length === 0) {
      this.problem('SPEC_SIGNATURE_WITHOUT_SIGNERS', { ref: step.ref });
      return assigned;
    }
    if (assigned.assignmentMode === 'PARALLEL') return assigned;
    const needsApprover = assignment.signers.some((signer) => signer.kind === 'APPROVER');
    const typeId = needsApprover && assigned.approvalGroupTypeId === null ? this.approvalType(step.ref, assignment.approvalType) : assigned.approvalGroupTypeId;
    return {
      ...assigned,
      signers: this.signerDocuments(step.ref, assignment.signers),
      approvalGroupTypeId: typeId,
      approvalLevel: needsApprover ? (assigned.approvalLevel ?? assignment.approvalLevel ?? 1) : assigned.approvalLevel,
    };
  }

  private withInitiators(steps: StepDocument[]): StepDocument[] {
    if (this.spec.initiators.length === 0) return steps;
    const initiators = this.spec.initiators.map((initiator): InitiatorDocument | null => {
      const id = initiator.kind === 'POSITION' ? this.positions.find(initiator.name) : this.groups.find(initiator.name);
      if (id === undefined) {
        this.problem(initiator.kind === 'POSITION' ? 'SPEC_UNKNOWN_POSITION' : 'SPEC_UNKNOWN_GROUP', { params: { name: initiator.name, in: 'initiators' } });
        return null;
      }
      return {
        id: this.childId('i'),
        participantType: initiator.kind,
        userId: null,
        positionId: initiator.kind === 'POSITION' ? id : null,
        groupId: initiator.kind === 'GROUP' ? id : null,
        departmentId: null,
        companyId: null,
        siteId: null,
      };
    });
    const resolved = initiators.filter((initiator): initiator is InitiatorDocument => initiator !== null);
    return steps.map((step) => (step.type === 'START' ? { ...step, initiators: resolved } : step));
  }

  private blockConfig(step: DraftStep): Record<string, unknown> {
    let raw: unknown = {};
    if (step.type === 'NOTIFICATION') {
      if (step.notification === null) {
        this.problem('SPEC_NOTIFICATION_MISSING', { ref: step.ref });
        return {};
      }
      raw = {
        recipients: step.notification.recipients.map((recipient) => this.recipient(step.ref, recipient)).filter((recipient) => recipient !== null),
        channels: ['IN_APP', 'EMAIL'],
        subject: step.notification.subject,
        body: plainParagraphs(step.notification.body),
      };
    } else if (step.type === 'WAIT') {
      if (step.wait === null) {
        this.problem('SPEC_WAIT_MISSING', { ref: step.ref });
        return {};
      }
      raw = { mode: 'DURATION', value: step.wait.value, unit: step.wait.unit };
    } else if (step.type === 'SIGNATURE') {
      raw = { document: step.signatureDocument ?? 'MAIN_DOCUMENT' };
    }
    const parsed = parseBlockConfig(step.type, raw);
    if (!parsed.valid) {
      this.problem('SPEC_BLOCK_CONFIG_INVALID', { ref: step.ref, params: { issues: parsed.issues } });
      return {};
    }
    return parsed.config;
  }

  private recipient(ref: string, recipient: { kind: string; name: string | null }): Record<string, string> | null {
    if (recipient.kind === 'CREATOR' || recipient.kind === 'ASSIGNEES' || recipient.kind === 'OBSERVERS') return { kind: recipient.kind };
    const id = recipient.kind === 'POSITION' ? this.positions.find(recipient.name) : this.groups.find(recipient.name);
    if (id === undefined) {
      this.problem(recipient.kind === 'POSITION' ? 'SPEC_UNKNOWN_POSITION' : 'SPEC_UNKNOWN_GROUP', { ref, params: { name: recipient.name ?? '' } });
      return null;
    }
    return { kind: recipient.kind, id };
  }

  private position(ref: string, name: string | null): string | null {
    const id = this.positions.find(name);
    if (id === undefined) this.problem('SPEC_UNKNOWN_POSITION', { ref, params: { name: name ?? '' } });
    return id ?? null;
  }

  private group(ref: string, name: string | null): string | null {
    const id = this.groups.find(name);
    if (id === undefined) this.problem('SPEC_UNKNOWN_GROUP', { ref, params: { name: name ?? '' } });
    return id ?? null;
  }

  private approvalType(ref: string, name: string | null): string | null {
    const id = this.approvalTypes.find(name) ?? (name === null ? this.approvalTypes.onlyOne : undefined);
    if (id === undefined) this.problem('SPEC_UNKNOWN_APPROVAL_TYPE', { ref, params: { name: name ?? '' } });
    return id ?? null;
  }

  private candidate(participantType: 'POSITION' | 'GROUP', id: string): CandidateDocument {
    return { id: this.childId('c'), participantType, userId: null, positionId: participantType === 'POSITION' ? id : null, groupId: participantType === 'GROUP' ? id : null };
  }

  private assignment(ref: string, assignment: DraftAssignment): Partial<StepDocument> {
    switch (assignment.mode) {
      case 'POSITION':
        return { assignmentMode: 'POSITION', positionId: this.position(ref, assignment.position) };
      case 'GROUP': {
        const id = this.group(ref, assignment.group);
        return { assignmentMode: 'GROUP', candidates: id === null ? [] : [this.candidate('GROUP', id)] };
      }
      case 'APPROVER':
        return { assignmentMode: 'APPROVER', approvalGroupTypeId: this.approvalType(ref, assignment.approvalType), approvalLevel: assignment.approvalLevel ?? 1 };
      case 'CREATOR':
        return { assignmentMode: 'CREATOR' };
      case 'POOL': {
        const candidates = [
          ...assignment.poolPositions.map((name) => this.position(ref, name)).filter((id): id is string => id !== null).map((id) => this.candidate('POSITION', id)),
          ...assignment.poolGroups.map((name) => this.group(ref, name)).filter((id): id is string => id !== null).map((id) => this.candidate('GROUP', id)),
        ];
        if (assignment.poolPositions.length + assignment.poolGroups.length === 0) this.problem('SPEC_POOL_EMPTY', { ref });
        return { assignmentMode: 'POOL', candidates };
      }
      case 'SAME_AS_STEP':
        if (assignment.sameAsStep === null || !this.stepsByRef.has(assignment.sameAsStep)) {
          this.problem('SPEC_UNKNOWN_REF', { ref, params: { target: assignment.sameAsStep ?? '' } });
          return { assignmentMode: 'SAME_AS_STEP' };
        }
        return { assignmentMode: 'SAME_AS_STEP', sameAssigneeStepId: stepIdOf(assignment.sameAsStep) };
      case 'PARALLEL_APPROVALS':
        return this.parallel(ref, assignment);
    }
  }

  private signerDocuments(ref: string, signers: DraftAssignment['signers']): SignerDocument[] {
    return signers.map((signer, index) => ({
      id: this.childId('s'),
      signerType: signer.kind,
      userId: null,
      positionId: signer.kind === 'POSITION' ? this.position(ref, signer.position) : null,
      extraPositionIds: [],
      label: null,
      sortOrder: index,
    }));
  }

  private parallel(ref: string, assignment: DraftAssignment): Partial<StepDocument> {
    if (assignment.signers.length === 0) this.problem('SPEC_PARALLEL_WITHOUT_SIGNERS', { ref });
    const needsApprover = assignment.signers.some((signer) => signer.kind === 'APPROVER');
    return {
      assignmentMode: 'PARALLEL',
      signers: this.signerDocuments(ref, assignment.signers),
      approvalGroupTypeId: needsApprover ? this.approvalType(ref, assignment.approvalType) : null,
      approvalLevel: needsApprover ? (assignment.approvalLevel ?? 1) : null,
    };
  }

  private transition(transition: DraftTransition, index: number, diversions: ReadonlyMap<string, DraftAmountRule>): TransitionDocument | null {
    const from = this.stepsByRef.get(transition.from);
    if (from === undefined || !this.stepsByRef.has(transition.to)) {
      this.problem('SPEC_UNKNOWN_REF', { transition: index, params: { target: from === undefined ? transition.from : transition.to } });
      return null;
    }
    const type = diversions.has(diversionKey(transition.from, transition.to)) ? 'SYSTEM_ONLY' : transitionType(from, transition);
    return {
      id: transitionIdOf(index),
      fromStepId: stepIdOf(transition.from),
      toStepId: stepIdOf(transition.to),
      type,
      label: transition.label,
      condition: type === 'CONDITION' ? (transition.condition ?? []).map((rule) => ({ ...rule, field: rule.field.trim().toUpperCase() })) : null,
      sortOrder: index,
      uiPoints: null,
      requiresComment: type === 'DECISION' && transition.requiresComment,
    };
  }

  /** The edges an EXTRA_APPROVAL rule sends tickets through: from the step it checks to its approval step. */
  private diversionPairs(): Map<string, DraftAmountRule> {
    const pairs = new Map<string, DraftAmountRule>();
    for (const rule of this.spec.amountRules) {
      if (rule.action === 'EXTRA_APPROVAL' && rule.step !== null && rule.approvalStep !== null && this.stepsByRef.has(rule.step) && this.stepsByRef.has(rule.approvalStep)) {
        pairs.set(diversionKey(rule.step, rule.approvalStep), rule);
      }
    }
    return pairs;
  }

  /** The model only names the approval step: the SYSTEM_ONLY edge into it is added unless the spec already drew it. */
  private diversionTransitions(diversions: ReadonlyMap<string, DraftAmountRule>): TransitionDocument[] {
    const drawn = new Set(this.spec.transitions.map((transition) => diversionKey(transition.from, transition.to)));
    const missing = [...diversions.entries()].filter(([key]) => !drawn.has(key));
    return missing.map(([, rule], offset) => {
      const index = this.spec.transitions.length + offset;
      return {
        id: transitionIdOf(index),
        fromStepId: stepIdOf(rule.step!),
        toStepId: stepIdOf(rule.approvalStep!),
        type: 'SYSTEM_ONLY',
        label: `Aprobación adicional: ${this.stepsByRef.get(rule.approvalStep!)!.name}`.slice(0, 120),
        condition: null,
        sortOrder: index,
        uiPoints: null,
        requiresComment: false,
      };
    });
  }

  private amountRules(): AmountRuleDocument[] {
    const rules = this.spec.amountRules.map((rule, index) => this.amountRule(rule, index));
    return rules.filter((rule): rule is AmountRuleDocument => rule !== null);
  }

  private amountRule(rule: DraftAmountRule, index: number): AmountRuleDocument | null {
    const at = { amountRule: index };
    const currency = (rule.currency ?? 'COP').trim().toUpperCase();
    const stepRef = (ref: string | null): ref is string => ref !== null && this.stepsByRef.has(ref);
    let valid = true;
    const fail = (code: string, params?: SpecProblem['params']): void => {
      valid = false;
      this.problem(code, { ...at, field: rule.field, ...(params === undefined ? {} : { params }) });
    };
    if (!CURRENCY_PATTERN.test(currency)) fail('SPEC_AMOUNT_RULE_CURRENCY_INVALID', { currency });
    if (rule.step !== null && !stepRef(rule.step)) fail('SPEC_UNKNOWN_REF', { target: rule.step });
    if (rule.action === 'EXTRA_APPROVAL') {
      if (rule.step === null) fail('SPEC_AMOUNT_RULE_STEP_REQUIRED');
      if (!stepRef(rule.approvalStep)) fail(rule.approvalStep === null ? 'SPEC_AMOUNT_RULE_APPROVAL_STEP_MISSING' : 'SPEC_UNKNOWN_REF', { target: rule.approvalStep ?? '' });
    }
    const positionId = rule.position === null ? null : this.positions.find(rule.position);
    if (rule.position !== null && positionId === undefined) fail('SPEC_UNKNOWN_POSITION', { name: rule.position });
    if (!valid) return null;
    return {
      id: amountRuleIdOf(index),
      stepId: rule.step === null ? null : stepIdOf(rule.step),
      positionId: positionId ?? null,
      companyId: null,
      fieldCode: rule.field.trim().toUpperCase(),
      rowTypeValue: null,
      amountColumn: rule.amountColumn === null ? null : rule.amountColumn.trim().toUpperCase(),
      typeColumn: null,
      maxAmount: rule.maxAmount.toFixed(2),
      currencyCode: currency,
      action: rule.action,
      approvalStepId: rule.action === 'EXTRA_APPROVAL' ? stepIdOf(rule.approvalStep!) : null,
      message: rule.message === null || rule.message === '' ? null : rule.message,
      isActive: true,
    };
  }

  private fields(): FieldDocument[] {
    const codes = new Set<string>();
    const perStep = new Map<string, number>();
    const fields: FieldDocument[] = [];
    this.spec.fields.forEach((field, index) => {
      const step = this.stepsByRef.get(field.step);
      if (step === undefined) return this.problem('SPEC_UNKNOWN_REF', { field: field.code, params: { target: field.step } });
      if (!FIELD_STEP_TYPES.has(step.type)) return this.problem('SPEC_FIELD_ON_AUTOMATIC_BLOCK', { ref: step.ref, field: field.code });
      if (!FIELD_CODE_PATTERN.test(field.code)) return this.problem('SPEC_FIELD_CODE_INVALID', { field: field.code });
      if (codes.has(field.code)) return this.problem('SPEC_FIELD_CODE_DUPLICATE', { field: field.code });
      codes.add(field.code);
      const config = this.fieldConfig(field);
      if (config === null) return;
      const sortOrder = perStep.get(step.ref) ?? 0;
      perStep.set(step.ref, sortOrder + 1);
      fields.push({
        id: fieldIdOf(index),
        stepId: stepIdOf(step.ref),
        code: field.code,
        label: field.label,
        type: field.type,
        capture: step.type === 'START' ? 'CREATION' : 'STEP',
        isRequired: field.type !== 'FORMULA' && field.required,
        isReadOnly: false,
        isImmutable: false,
        sortOrder,
        config,
        dataSource: null,
      });
    });
    return fields;
  }

  private fieldConfig(field: DraftField): Record<string, unknown> | null {
    let raw: Record<string, unknown> = {};
    if (field.type === 'SELECT' || field.type === 'MULTI_SELECT') {
      if (field.options === null || field.options.length === 0) {
        this.problem('SPEC_FIELD_OPTIONS_MISSING', { field: field.code });
        return null;
      }
      raw = { options: optionList(field.options) };
    } else if (field.type === 'FORMULA') {
      if (field.formula === null) {
        this.problem('SPEC_FORMULA_MISSING', { field: field.code });
        return null;
      }
      raw = { expression: field.formula.expression, resultType: field.formula.resultType };
    } else if (field.type === 'TABLE') {
      if (field.columns === null || field.columns.length === 0) {
        this.problem('SPEC_TABLE_COLUMNS_MISSING', { field: field.code });
        return null;
      }
      raw = {
        minRows: field.required ? 1 : 0,
        columns: field.columns.map((column) => {
          const formula = column.type === 'FORMULA';
          return {
            code: column.code,
            label: column.label,
            type: column.type,
            required: !formula && column.required,
            ...(formula ? { expression: column.expression ?? '' } : {}),
            ...(column.type === 'SELECT' && column.options !== null ? { options: optionList(column.options) } : {}),
            showTotal: NUMERIC_COLUMNS.has(column.type) && column.showTotal,
          };
        }),
      };
    } else if (field.type === 'FILE') {
      raw = { maxFiles: 5 };
    }
    const parsed = parseFieldConfig(field.type, raw, null);
    if (!parsed.valid) {
      this.problem('SPEC_FIELD_CONFIG_INVALID', { field: field.code, params: { issues: parsed.issues } });
      return null;
    }
    return parsed.config;
  }
}

const diversionKey = (from: string, to: string): string => `${from}\u0000${to}`;

function optionList(labels: readonly string[]): Array<{ value: string; label: string }> {
  return [...new Set(labels)].map((label) => ({ value: label, label }));
}

/**
 * The model never says how a transition is taken: it follows from the block it leaves. A CONDITION branches
 * by rule (DEFAULT for «the rest»), other automatic blocks just continue, a parallel step's rejection is the
 * engine's, and a person's step leaves by their decision.
 */
function transitionType(from: DraftStep, transition: DraftTransition): TransitionType {
  if (from.type === 'CONDITION') return transition.condition !== null && transition.condition.length > 0 ? 'CONDITION' : 'DEFAULT';
  if (isAutomaticStep(from.type)) return 'DEFAULT';
  if (from.assignment?.mode === 'PARALLEL_APPROVALS' && transition.whenRejected) return 'SYSTEM_ONLY';
  return 'DECISION';
}

/** A first arrangement (columns by distance from START) so nothing piles up; the builder's «Ordenar» refines it. */
function layeredPositions(spec: WorkflowDraftSpec): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>();
  const queue = spec.steps.filter((step) => step.type === 'START').map((step) => step.ref);
  for (const ref of queue) depth.set(ref, 0);
  while (queue.length > 0) {
    const ref = queue.shift()!;
    for (const transition of spec.transitions.filter((candidate) => candidate.from === ref)) {
      if (depth.has(transition.to)) continue;
      depth.set(transition.to, depth.get(ref)! + 1);
      queue.push(transition.to);
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  const rows = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const step of spec.steps) {
    const column = depth.get(step.ref) ?? maxDepth + 1;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    positions.set(step.ref, { x: column * COLUMN_GAP, y: row * ROW_GAP });
  }
  return positions;
}

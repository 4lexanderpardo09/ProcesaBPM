import {
  DEFAULT_EXIT_STEP_TYPES,
  findEngineSupportProblems,
  isAutomaticStep,
  type SaveGraphRequest,
  type StepDocument,
  type StepType,
  type TransitionDocument,
  type TransitionType,
  validateWorkflowGraph,
  type WorkflowValidation,
  type WorkflowVersionDocument,
} from '@procesabpm/shared';
import { defaultsFor } from './block-catalog';

/** What the person has on the canvas: one block or one connection, or nothing. */
export type Selection = { readonly kind: 'step'; readonly id: string } | { readonly kind: 'transition'; readonly id: string } | null;

/** Labels a new connection gets (the caller translates them). */
export interface ConnectionLabels {
  readonly continue: string;
  readonly approve: string;
  readonly reject: string;
  readonly otherwise: string;
  readonly branch: (index: number) => string;
  readonly option: (index: number) => string;
}

const nextRef = (prefix: string, ids: readonly string[]): string => {
  const used = new Set(ids);
  let index = ids.length + 1;
  while (used.has(`new:${prefix}${String(index)}`)) index += 1;
  return `new:${prefix}${String(index)}`;
};

/** A name nobody else on the canvas has ("Aprobación 2"): the validator refuses repeated names. */
export function uniqueName(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((name) => name.trim().toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  let index = 2;
  while (lower.has(`${base} ${String(index)}`.toLowerCase())) index += 1;
  return `${base} ${String(index)}`;
}

export function addStep(doc: WorkflowVersionDocument, type: StepType, name: string, position: { x: number; y: number }): { doc: WorkflowVersionDocument; id: string } {
  const id = nextRef('b', doc.steps.map((step) => step.id));
  const { assignmentMode, config } = defaultsFor(type);
  const step: StepDocument = {
    id,
    type,
    name: uniqueName(name, doc.steps.map((candidate) => candidate.name)),
    description: null,
    assignmentMode,
    manualSelection: false,
    siteScope: 'SAME_SITE',
    positionId: null,
    approvalGroupTypeId: null,
    approvalLevel: assignmentMode === 'APPROVER' ? 1 : null,
    closeRule: 'NOT_ALLOWED',
    slaValue: null,
    slaUnit: null,
    deadlineType: 'SLA',
    deadlineFieldCode: null,
    deadlineBusinessDays: null,
    maxLoops: null,
    dispatchIntervalMin: null,
    allowsBatch: false,
    config,
    ui: { x: Math.round(position.x), y: Math.round(position.y) },
    candidates: [],
    initiators: [],
    slaOverrides: [],
    signers: [],
    files: [],
  };
  return { doc: { ...doc, steps: [...doc.steps, step] }, id };
}

const BLOCK_SPAN = { width: 200, height: 88 };

/** Where a block added by a click goes: at `position`, or lower down until it no longer covers another block. */
export function freeSpot(doc: WorkflowVersionDocument, position: { x: number; y: number }): { x: number; y: number } {
  let y = position.y;
  const covers = (candidateY: number) => doc.steps.some((step) => Math.abs(step.ui.x - position.x) < BLOCK_SPAN.width && Math.abs(step.ui.y - candidateY) < BLOCK_SPAN.height);
  for (let tries = 0; tries < 50 && covers(y); tries += 1) y += BLOCK_SPAN.height + 8;
  return { x: position.x, y };
}

export function moveStep(doc: WorkflowVersionDocument, id: string, position: { x: number; y: number }): WorkflowVersionDocument {
  return updateStep(doc, id, { ui: { x: Math.round(position.x), y: Math.round(position.y) } });
}

export function updateStep(doc: WorkflowVersionDocument, id: string, patch: Partial<StepDocument>): WorkflowVersionDocument {
  return { ...doc, steps: doc.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)) };
}

/** The block goes with every connection that touches it. */
export function removeStep(doc: WorkflowVersionDocument, id: string): WorkflowVersionDocument {
  return {
    ...doc,
    steps: doc.steps.filter((step) => step.id !== id),
    transitions: doc.transitions.filter((transition) => transition.fromStepId !== id && transition.toStepId !== id),
  };
}

export function updateTransition(doc: WorkflowVersionDocument, id: string, patch: Partial<TransitionDocument>): WorkflowVersionDocument {
  return { ...doc, transitions: doc.transitions.map((transition) => (transition.id === id ? { ...transition, ...patch } : transition)) };
}

export function removeTransition(doc: WorkflowVersionDocument, id: string): WorkflowVersionDocument {
  return { ...doc, transitions: doc.transitions.filter((transition) => transition.id !== id) };
}

/** Why a connection cannot be drawn, or `null` when it can. */
export type ConnectRefusal = 'fromEnd' | 'toStart' | 'toItself' | 'defaultTaken' | 'unknown';

function uniqueLabel(base: string, taken: readonly string[]): string {
  return uniqueName(base, taken);
}

/**
 * A connection with the type its origin needs: a person's block leaves by decisions, an automatic one by its single
 * default way, a condition by rules (the first one drawn is its "otherwise").
 */
export function connect(doc: WorkflowVersionDocument, fromId: string, toId: string, labels: ConnectionLabels): { doc: WorkflowVersionDocument; id: string } | { refusal: ConnectRefusal } {
  const from = doc.steps.find((step) => step.id === fromId);
  const to = doc.steps.find((step) => step.id === toId);
  if (from === undefined || to === undefined) return { refusal: 'unknown' };
  if (from.type === 'END') return { refusal: 'fromEnd' };
  if (to.type === 'START') return { refusal: 'toStart' };
  if (from.id === to.id && isAutomaticStep(from.type)) return { refusal: 'toItself' };
  const exits = doc.transitions.filter((transition) => transition.fromStepId === from.id);
  const taken = exits.map((exit) => exit.label);
  const hasDefault = exits.some((exit) => exit.type === 'DEFAULT');

  let type: TransitionType;
  let label: string;
  if (from.type === 'CONDITION') {
    type = hasDefault ? 'CONDITION' : 'DEFAULT';
    label = hasDefault ? labels.branch(exits.filter((exit) => exit.type === 'CONDITION').length + 1) : labels.otherwise;
  } else if (DEFAULT_EXIT_STEP_TYPES.has(from.type)) {
    if (hasDefault) return { refusal: 'defaultTaken' };
    type = 'DEFAULT';
    label = labels.continue;
  } else {
    type = 'DECISION';
    const decisions = exits.filter((exit) => exit.type === 'DECISION').length;
    if (from.type === 'APPROVAL') label = decisions === 0 ? labels.approve : decisions === 1 ? labels.reject : labels.option(decisions + 1);
    else if (from.type === 'DECISION') label = labels.option(decisions + 1);
    else label = decisions === 0 ? labels.continue : labels.option(decisions + 1);
  }
  const id = nextRef('t', doc.transitions.map((transition) => transition.id));
  const transition: TransitionDocument = {
    id,
    fromStepId: from.id,
    toStepId: to.id,
    type,
    label: uniqueLabel(label, taken),
    condition: null,
    sortOrder: exits.length,
    uiPoints: null,
  };
  return { doc: { ...doc, transitions: [...doc.transitions, transition] }, id };
}

/**
 * The system-only way from a step to the approval an amount rule asks for: the engine takes it when the amount is passed
 * (`AMOUNT_RULE_EXTRA_APPROVAL_NOT_WIRED` until it exists).
 */
export function connectSystem(doc: WorkflowVersionDocument, fromId: string, toId: string, label: string): { doc: WorkflowVersionDocument; id: string } {
  const existing = doc.transitions.find((transition) => transition.type === 'SYSTEM_ONLY' && transition.fromStepId === fromId && transition.toStepId === toId);
  if (existing !== undefined) return { doc, id: existing.id };
  const exits = doc.transitions.filter((transition) => transition.fromStepId === fromId);
  const id = nextRef('t', doc.transitions.map((transition) => transition.id));
  const transition: TransitionDocument = {
    id,
    fromStepId: fromId,
    toStepId: toId,
    type: 'SYSTEM_ONLY',
    label: uniqueName(label, exits.map((exit) => exit.label)),
    condition: null,
    sortOrder: exits.length,
    uiPoints: null,
  };
  return { doc: { ...doc, transitions: [...doc.transitions, transition] }, id };
}

/** The same check the API runs on a draft: design rules plus what the engine cannot run yet. */
export function validateDraft(doc: WorkflowVersionDocument): WorkflowValidation {
  const design = validateWorkflowGraph(doc);
  const engine = findEngineSupportProblems(doc);
  return { errors: [...design.errors, ...engine.filter((problem) => problem.severity === 'error')], warnings: [...design.warnings, ...engine.filter((problem) => problem.severity === 'warning')] };
}

/** What `PUT …/graph` takes: blocks and connections without what hangs off the blocks (edited one by one). */
export function toSaveRequest(doc: WorkflowVersionDocument, revision: number): SaveGraphRequest {
  return {
    revision,
    steps: doc.steps.map(({ candidates: _candidates, initiators: _initiators, slaOverrides: _slaOverrides, signers: _signers, files: _files, ...step }) => step),
    transitions: doc.transitions.map((transition) => ({ ...transition, uiPoints: transition.uiPoints === null ? null : [...transition.uiPoints] })),
  };
}

/** After a save, the selection follows the block or connection under its new id. */
export function remapSelection(selection: Selection, idMap: Readonly<Record<string, string>>): Selection {
  if (selection === null) return null;
  const id = idMap[selection.id];
  return id === undefined ? selection : { ...selection, id };
}

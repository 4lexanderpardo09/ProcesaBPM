import type { AmountRuleDocument, FieldDocument, StepDocument, TransitionDocument, WorkflowVersionDocument } from './document.js';
import { type StepType, isAutomaticStep } from './constants.js';

/** Builders for tests: valid defaults that each test overrides. Kept out of the public index. */
export function step(id: string, type: StepType, overrides: Partial<StepDocument> = {}): StepDocument {
  const automatic = isAutomaticStep(type);
  const peopleConfig: Record<string, Record<string, unknown>> = { SIGNATURE: { document: 'MAIN_DOCUMENT' } };
  return {
    id,
    type,
    name: id,
    description: null,
    assignmentMode: automatic ? 'NONE' : 'CREATOR',
    manualSelection: false,
    siteScope: 'SAME_SITE',
    positionId: null,
    approvalGroupTypeId: null,
    approvalLevel: null,
    closeRule: 'NOT_ALLOWED',
    slaValue: null,
    slaUnit: null,
    deadlineType: 'SLA',
    deadlineFieldCode: null,
    deadlineBusinessDays: null,
    maxLoops: null,
    dispatchIntervalMin: null,
    allowsBatch: false,
    config: peopleConfig[type] ?? {},
    ui: { x: 0, y: 0 },
    candidates: [],
    initiators: [],
    slaOverrides: [],
    signers: type === 'SIGNATURE' ? [{ id: `${id}-signer`, signerType: 'CREATOR', userId: null, positionId: null, label: null, sortOrder: 0 }] : [],
    files: [],
    ...overrides,
  };
}

export function transition(id: string, from: string, to: string, type: TransitionDocument['type'], overrides: Partial<TransitionDocument> = {}): TransitionDocument {
  return { id, fromStepId: from, toStepId: to, type, label: id, condition: null, sortOrder: 0, uiPoints: null, ...overrides };
}

export const next = (from: string, to: string, type: 'DEFAULT' | 'DECISION' = 'DEFAULT'): TransitionDocument => transition(`${from}->${to}`, from, to, type);

export function field(id: string, stepId: string, code: string, overrides: Partial<FieldDocument> = {}): FieldDocument {
  return { id, stepId, code, label: code, type: 'TEXT', capture: 'BOTH', isRequired: false, isReadOnly: false, sortOrder: 0, config: {}, dataSource: null, ...overrides };
}

export function amountRule(id: string, fieldCode: string, overrides: Partial<AmountRuleDocument> = {}): AmountRuleDocument {
  return { id, stepId: null, positionId: null, companyId: null, fieldCode, rowTypeValue: null, amountColumn: null, typeColumn: null, maxAmount: '1000.00', currencyCode: 'COP', action: 'BLOCK', approvalStepId: null, message: null, isActive: true, ...overrides };
}

export function version(parts: Partial<WorkflowVersionDocument> = {}): WorkflowVersionDocument {
  return { steps: [], transitions: [], fields: [], amountRules: [], ...parts };
}

/** START -> TASK -> END with a valid decision: the smallest publishable flow. */
export function minimalFlow(): WorkflowVersionDocument {
  return version({
    steps: [step('start', 'START'), step('task', 'TASK'), step('end', 'END')],
    transitions: [next('start', 'task'), next('task', 'end', 'DECISION')],
  });
}

import type { FieldDocument, StepDocument, TransitionDocument, WorkflowVersionDocument } from '@procesabpm/shared';

export const id = (index: number) => `018f0000-0000-7000-8000-${String(index).padStart(12, '0')}`;
export const FLOW = id(20);
export const DRAFT = id(22);
export const START = id(30);
export const END = id(31);
export const at = '2026-10-21T15:00:00.000Z';
export const versionUrl = `/workflows/${FLOW}/versions/${DRAFT}`;

/** A block with every key the API sends (absent values are null or empty lists). */
export function step(stepId: string, type: StepDocument['type'], name: string, overrides: Partial<StepDocument> = {}): StepDocument {
  return {
    id: stepId,
    type,
    name,
    description: null,
    assignmentMode: 'NONE',
    manualSelection: false,
    siteScope: 'SAME_SITE',
    positionId: null,
    approvalGroupTypeId: null,
    approvalLevel: null,
    sameAssigneeStepId: null,
    closeRule: 'NOT_ALLOWED',
    slaValue: null,
    slaUnit: null,
    deadlineType: 'SLA',
    deadlineFieldCode: null,
    deadlineBusinessDays: null,
    maxLoops: null,
    dispatchIntervalMin: null,
    allowsBatch: false,
    config: {},
    ui: { x: 0, y: 0 },
    candidates: [],
    initiators: [],
    slaOverrides: [],
    signers: [],
    files: [],
    ...overrides,
  };
}

export const link = (transitionId: string, from: string, to: string, overrides: Partial<TransitionDocument> = {}): TransitionDocument => ({
  id: transitionId,
  fromStepId: from,
  toStepId: to,
  type: 'DEFAULT',
  label: 'Continuar',
  condition: null,
  sortOrder: 0,
  uiPoints: null,
  requiresComment: false,
  ...overrides,
});

export const field = (fieldId: string, stepId: string, code: string, label: string, type: FieldDocument['type'], overrides: Partial<FieldDocument> = {}): FieldDocument => ({
  id: fieldId,
  stepId,
  code,
  label,
  type,
  capture: 'CREATION',
  isRequired: false,
  isReadOnly: false,
  isImmutable: false,
  sortOrder: 0,
  config: {},
  dataSource: null,
  ...overrides,
});

export const startingDoc = (): WorkflowVersionDocument => ({
  steps: [step(START, 'START', 'Inicio'), step(END, 'END', 'Fin', { ui: { x: 400, y: 0 } })],
  transitions: [link(id(40), START, END)],
  fields: [],
  amountRules: [],
});

export const versionOf = (status: string, revision = 0) => ({ id: DRAFT, number: 2, status, notes: null, revision, publishedAt: status === 'DRAFT' ? null : at, publishedById: null, createdAt: at });

export const page = <T,>(items: readonly T[]) => ({ items, page: 1, pageSize: 100, total: items.length });

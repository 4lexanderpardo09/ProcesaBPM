import type { AssignmentMode, CloseRule, FieldType, SiteScope, StepType, TransitionType } from './constants.js';
import type { TransitionCondition } from './transition-condition.js';

/**
 * A block or transition reference: the UUID of an existing row, or `new:<name>` for one the client just
 * drew on the canvas. The validator treats ids as opaque strings, so it works on unsaved canvases too.
 */
export type BlockRef = string;
export const NEW_REF_PATTERN = /^new:[A-Za-z0-9_-]{1,64}$/;
export const isNewRef = (ref: string): boolean => NEW_REF_PATTERN.test(ref);

export interface CandidateDocument {
  readonly id: string;
  readonly participantType: 'USER' | 'POSITION' | 'GROUP';
  readonly userId: string | null;
  readonly positionId: string | null;
  readonly groupId: string | null;
}

export interface InitiatorDocument {
  readonly id: string;
  readonly participantType: 'USER' | 'POSITION' | 'GROUP' | 'DEPARTMENT' | 'COMPANY' | 'SITE';
  readonly userId: string | null;
  readonly positionId: string | null;
  readonly groupId: string | null;
  readonly departmentId: string | null;
  readonly companyId: string | null;
  readonly siteId: string | null;
}

export interface SlaOverrideDocument {
  readonly companyId: string;
  readonly slaValue: number;
  readonly slaUnit: 'BUSINESS_HOURS' | 'BUSINESS_DAYS';
}

export interface SignerDocument {
  readonly id: string;
  readonly signerType: 'USER' | 'POSITION' | 'APPROVER' | 'CREATOR' | 'STEP_ASSIGNEE';
  readonly userId: string | null;
  readonly positionId: string | null;
  readonly label: string | null;
  readonly sortOrder: number;
}

export interface StepFileDocument {
  readonly fileId: string;
  readonly label: string;
  readonly sortOrder: number;
}

/** A canvas block with everything that hangs off it. Absent values are `null`, never missing keys. */
export interface StepDocument {
  readonly id: BlockRef;
  readonly type: StepType;
  readonly name: string;
  readonly description: string | null;
  readonly assignmentMode: AssignmentMode;
  readonly manualSelection: boolean;
  readonly siteScope: SiteScope;
  readonly positionId: string | null;
  readonly approvalGroupTypeId: string | null;
  readonly approvalLevel: number | null;
  readonly closeRule: CloseRule;
  readonly slaValue: number | null;
  readonly slaUnit: 'BUSINESS_HOURS' | 'BUSINESS_DAYS' | null;
  readonly deadlineType: 'SLA' | 'CUTOFF';
  readonly deadlineFieldCode: string | null;
  readonly deadlineBusinessDays: number | null;
  readonly maxLoops: number | null;
  readonly dispatchIntervalMin: number | null;
  readonly allowsBatch: boolean;
  readonly config: Record<string, unknown>;
  readonly ui: { readonly x: number; readonly y: number };
  readonly candidates: readonly CandidateDocument[];
  readonly initiators: readonly InitiatorDocument[];
  readonly slaOverrides: readonly SlaOverrideDocument[];
  readonly signers: readonly SignerDocument[];
  readonly files: readonly StepFileDocument[];
}

export interface TransitionDocument {
  readonly id: BlockRef;
  readonly fromStepId: BlockRef;
  readonly toStepId: BlockRef;
  readonly type: TransitionType;
  readonly label: string;
  /** Set for CONDITION transitions, `null` for the rest. */
  readonly condition: TransitionCondition | null;
  readonly sortOrder: number;
  readonly uiPoints: ReadonlyArray<{ readonly x: number; readonly y: number }> | null;
}

export interface FieldDocument {
  readonly id: BlockRef;
  readonly stepId: BlockRef;
  readonly code: string;
  readonly label: string;
  readonly type: FieldType;
  readonly capture: 'CREATION' | 'STEP' | 'BOTH';
  readonly isRequired: boolean;
  readonly isReadOnly: boolean;
  readonly sortOrder: number;
  readonly config: Record<string, unknown>;
  readonly dataSource: Record<string, unknown> | null;
}

export interface AmountRuleDocument {
  readonly id: BlockRef;
  readonly stepId: BlockRef | null;
  readonly positionId: string | null;
  readonly companyId: string | null;
  readonly fieldCode: string;
  readonly rowTypeValue: string | null;
  readonly amountColumn: string | null;
  readonly typeColumn: string | null;
  /** A decimal string: money never travels as a float. */
  readonly maxAmount: string;
  readonly currencyCode: string;
  readonly action: 'BLOCK' | 'WARN' | 'EXTRA_APPROVAL';
  readonly approvalStepId: BlockRef | null;
  readonly message: string | null;
  readonly isActive: boolean;
}

/** Everything the validator, the canvas and a version copy work with. */
export interface WorkflowVersionDocument {
  readonly steps: readonly StepDocument[];
  readonly transitions: readonly TransitionDocument[];
  readonly fields: readonly FieldDocument[];
  readonly amountRules: readonly AmountRuleDocument[];
}

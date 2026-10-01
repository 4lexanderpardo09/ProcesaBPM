export const STEP_TYPES = [
  'START',
  'TASK',
  'APPROVAL',
  'CONDITION',
  'DECISION',
  'DOCUMENT',
  'SIGNATURE',
  'EXPORT',
  'NOTIFICATION',
  'WEBHOOK',
  'CALCULATOR',
  'WAIT',
  'END',
] as const;
export type StepType = (typeof STEP_TYPES)[number];

/** Blocks the engine runs by itself: they have no assignee, no SLA and no manual close (mirrors `is_automatic_step`). */
export const AUTOMATIC_STEP_TYPES: ReadonlySet<StepType> = new Set(['START', 'CONDITION', 'DOCUMENT', 'EXPORT', 'NOTIFICATION', 'WEBHOOK', 'CALCULATOR', 'WAIT', 'END']);
/** Automatic blocks that leave through a single DEFAULT transition (CONDITION has its own branches, END none). */
export const DEFAULT_EXIT_STEP_TYPES: ReadonlySet<StepType> = new Set(['START', 'DOCUMENT', 'EXPORT', 'NOTIFICATION', 'WEBHOOK', 'CALCULATOR', 'WAIT']);
/** Blocks handled by a person: they leave through DECISION transitions. */
export const PEOPLE_STEP_TYPES: ReadonlySet<StepType> = new Set(['TASK', 'APPROVAL', 'DECISION', 'SIGNATURE']);

export const isAutomaticStep = (type: StepType): boolean => AUTOMATIC_STEP_TYPES.has(type);

export const ASSIGNMENT_MODES = ['NONE', 'POSITION', 'USERS', 'GROUP', 'CREATOR', 'APPROVER', 'POOL', 'PARALLEL', 'RANDOM_DISPATCH'] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

export const SITE_SCOPES = ['SAME_SITE', 'PARENT_SITE', 'ANY_SITE'] as const;
export type SiteScope = (typeof SITE_SCOPES)[number];

export const CLOSE_RULES = ['NOT_ALLOWED', 'ALLOWED', 'REQUIRED'] as const;
export type CloseRule = (typeof CLOSE_RULES)[number];

export const SLA_UNITS = ['BUSINESS_HOURS', 'BUSINESS_DAYS'] as const;
export const DEADLINE_TYPES = ['SLA', 'CUTOFF'] as const;

export const TRANSITION_TYPES = ['DECISION', 'CONDITION', 'DEFAULT', 'SYSTEM_ONLY'] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'CURRENCY', 'SELECT', 'MULTI_SELECT', 'DATE', 'DATETIME', 'DAYS', 'SITE', 'USER', 'TABLE', 'FILE', 'FORMULA', 'CALCULATOR'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const CAPTURE_STAGES = ['CREATION', 'STEP', 'BOTH'] as const;
export const AMOUNT_RULE_ACTIONS = ['BLOCK', 'WARN', 'EXTRA_APPROVAL'] as const;
export const PARTICIPANT_TYPES = ['USER', 'POSITION', 'GROUP', 'DEPARTMENT', 'COMPANY', 'SITE'] as const;
export const CANDIDATE_PARTICIPANT_TYPES = ['USER', 'POSITION', 'GROUP'] as const;
export const SIGNER_TYPES = ['USER', 'POSITION', 'APPROVER', 'CREATOR', 'STEP_ASSIGNEE'] as const;

/** Field codes are upper snake case (database CHECK `fields_code_format`). */
export const FIELD_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,99}$/;

export const MAX_STEPS_PER_VERSION = 500;
export const MAX_TRANSITIONS_PER_VERSION = 2000;

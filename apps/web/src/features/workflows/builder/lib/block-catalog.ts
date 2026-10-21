import { type AssignmentMode, isAutomaticStep, PEOPLE_STEP_TYPES, type StepType } from '@procesabpm/shared';

/** The design token of each block type's color (docs/diseno/README.md, "Flujos"). */
export const BLOCK_COLOR: Readonly<Record<StepType, string>> = {
  START: 'var(--block-start)',
  END: 'var(--block-end)',
  TASK: 'var(--block-step)',
  APPROVAL: 'var(--block-approval)',
  DECISION: 'var(--block-decision)',
  SIGNATURE: 'var(--block-approval)',
  CONDITION: 'var(--block-condition)',
  CALCULATOR: 'var(--block-calculator)',
  WAIT: 'var(--block-wait)',
  DOCUMENT: 'var(--block-document)',
  NOTIFICATION: 'var(--block-notification)',
  EXPORT: 'var(--block-export)',
  WEBHOOK: 'var(--block-webhook)',
};

/**
 * The palette, as in the prototype. WEBHOOK and EXPORT are left out: the engine does not run them yet, so a version with
 * one can never be published (`NOT_IMPLEMENTED_*`); one copied from an older version still shows and explains itself.
 */
export const PALETTE_GROUPS: ReadonlyArray<{ readonly key: 'edges' | 'people' | 'automatic' | 'effects'; readonly types: readonly StepType[] }> = [
  { key: 'edges', types: ['START', 'END'] },
  { key: 'people', types: ['TASK', 'APPROVAL', 'DECISION', 'SIGNATURE'] },
  { key: 'automatic', types: ['CONDITION', 'CALCULATOR', 'WAIT'] },
  { key: 'effects', types: ['DOCUMENT', 'NOTIFICATION'] },
];

export const NOT_AVAILABLE_TYPES: ReadonlySet<StepType> = new Set(['WEBHOOK', 'EXPORT']);

export const isPeopleStep = (type: StepType): boolean => PEOPLE_STEP_TYPES.has(type);

/** Effects run on their own and the ticket goes on: their way out is drawn dashed. */
export const EFFECT_TYPES: ReadonlySet<StepType> = new Set(['DOCUMENT', 'NOTIFICATION', 'EXPORT', 'WEBHOOK', 'CALCULATOR']);

/** How a new block of each type starts: valid when it can be (a task assigned to the creator), or pointing at what is missing. */
export function defaultsFor(type: StepType): { readonly assignmentMode: AssignmentMode; readonly config: Record<string, unknown> } {
  const assignmentMode: AssignmentMode = isAutomaticStep(type) ? 'NONE' : type === 'APPROVAL' ? 'APPROVER' : 'CREATOR';
  switch (type) {
    case 'SIGNATURE':
      return { assignmentMode, config: { document: 'MAIN_DOCUMENT' } };
    case 'NOTIFICATION':
      return { assignmentMode, config: { recipients: [{ kind: 'CREATOR' }], channels: ['IN_APP', 'EMAIL'], subject: 'Novedad en el ticket {{ticket.number}}', body: '' } };
    case 'WAIT':
      return { assignmentMode, config: { mode: 'DURATION', value: 1, unit: 'BUSINESS_DAYS' } };
    default:
      return { assignmentMode, config: {} };
  }
}

import { isAutomaticStep } from '../constants.js';
import { effectiveFieldType } from '../transition-condition.js';
import { parseBlockConfig } from '../block-config.js';
import { type RuleContext } from './context.js';

const TEMPLATE_CODE = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;

function templateCodes(text: unknown): string[] {
  return typeof text === 'string' ? [...text.matchAll(TEMPLATE_CODE)].map((match) => match[1]!) : [];
}

/** Assignment, SLA, deadline and `config` of each block. */
export function checkSteps({ doc, fieldByCode, problems }: RuleContext): void {
  for (const step of doc.steps) {
    const at = { stepId: step.id };
    const automatic = isAutomaticStep(step.type);

    if (automatic !== (step.assignmentMode === 'NONE')) problems.error('ASSIGNMENT_MODE_INVALID', at);
    if (automatic && (step.slaValue !== null || step.closeRule !== 'NOT_ALLOWED' || step.manualSelection)) problems.error('AUTOMATIC_BLOCK_WITH_SLA', at);
    if (automatic && (step.candidates.length > 0 || step.slaOverrides.length > 0 || step.signers.length > 0)) problems.error('CHILDREN_ON_AUTOMATIC_BLOCK', at);
    if (step.type !== 'START' && step.initiators.length > 0) problems.error('INITIATORS_ON_NON_START', at);

    if (step.assignmentMode === 'APPROVER' && (step.approvalGroupTypeId === null || step.approvalLevel === null || step.approvalLevel < 1)) problems.error('APPROVER_CONFIG_MISSING', at);
    if (step.assignmentMode === 'POSITION' && step.positionId === null) problems.error('POSITION_MISSING', at);
    const candidates = (type: string) => step.candidates.filter((candidate) => candidate.participantType === type).length;
    if (
      (step.assignmentMode === 'USERS' && candidates('USER') === 0) ||
      (step.assignmentMode === 'GROUP' && candidates('GROUP') === 0) ||
      ((step.assignmentMode === 'POOL' || step.assignmentMode === 'RANDOM_DISPATCH') && step.candidates.length === 0 && step.positionId === null)
    ) {
      problems.error('ASSIGNMENT_MISSING_CANDIDATES', { ...at, params: { mode: step.assignmentMode } });
    }
    if (step.assignmentMode === 'RANDOM_DISPATCH' && (step.dispatchIntervalMin === null || step.dispatchIntervalMin <= 0)) problems.error('RANDOM_DISPATCH_WITHOUT_INTERVAL', at);
    if (step.assignmentMode === 'PARALLEL' && step.signers.length === 0) problems.error('PARALLEL_WITHOUT_SIGNERS', at);
    if (step.type === 'SIGNATURE' && step.signers.length === 0) problems.error('SIGNATURE_WITHOUT_SIGNERS', at);
    if (step.manualSelection && ['CREATOR', 'APPROVER', 'PARALLEL', 'RANDOM_DISPATCH'].includes(step.assignmentMode)) problems.warning('MANUAL_SELECTION_NOT_APPLICABLE', at);

    if (step.deadlineType === 'CUTOFF') {
      if (automatic) problems.error('CUTOFF_ON_AUTOMATIC_BLOCK', at);
      if (step.deadlineFieldCode === null || step.deadlineBusinessDays === null || step.deadlineBusinessDays <= 0) problems.error('CUTOFF_CONFIG_MISSING', at);
      else {
        const field = fieldByCode.get(step.deadlineFieldCode);
        if (field === undefined) problems.error('DEADLINE_FIELD_UNKNOWN', { ...at, params: { code: step.deadlineFieldCode } });
        else if (field.type !== 'DATE' && field.type !== 'DATETIME') problems.error('DEADLINE_FIELD_NOT_DATE', { ...at, params: { code: step.deadlineFieldCode } });
      }
    }

    const config = parseBlockConfig(step.type, step.config);
    if (!config.valid) problems.error('BLOCK_CONFIG_INVALID', { ...at, params: { issues: config.issues } });
    else {
      if ('batch' in config.config && config.config.batch !== undefined && !step.allowsBatch) problems.error('BATCH_CONFIG_WITHOUT_ALLOWS_BATCH', at);
      const codes = [...templateCodes(config.config.subject), ...templateCodes(config.config.body), ...templateCodes(config.config.bodyTemplate)];
      const unknown = [...new Set(codes.filter((code) => !fieldByCode.has(code)))];
      if (unknown.length > 0) problems.warning('TEMPLATE_UNKNOWN_FIELD', { ...at, params: { codes: unknown } });
      for (const code of Object.values((config.config.inputs ?? {}) as Record<string, string>).concat(typeof config.config.outputFieldCode === 'string' ? [config.config.outputFieldCode] : [])) {
        if (!fieldByCode.has(code)) problems.error('CALCULATOR_UNKNOWN_FIELD', { ...at, params: { code } });
      }
      if (step.type === 'WAIT' && config.config.mode === 'UNTIL_FIELD_DATE') {
        const waitField = fieldByCode.get(String(config.config.fieldCode));
        if (waitField === undefined) problems.error('WAIT_UNKNOWN_FIELD', { ...at, params: { code: String(config.config.fieldCode) } });
        else if (!['DATE', 'DATETIME'].includes(effectiveFieldType(waitField))) problems.error('WAIT_FIELD_NOT_DATE', { ...at, params: { code: waitField.code } });
      }
    }
  }
}

import { describe, expect, it } from 'vitest';
import { findEngineSupportProblems } from './engine-support.js';
import { amountRule, field, minimalFlow, next, step, transition, version } from './test-builders.js';

const codes = (doc: Parameters<typeof findEngineSupportProblems>[0]) => findEngineSupportProblems(doc).map((problem) => problem.code);

describe('findEngineSupportProblems', () => {
  it('accepts the minimal flow', () => expect(codes(minimalFlow())).toEqual([]));

  it('accepts PARALLEL assignment now', () => expect(codes(version({ steps: [step('t', 'TASK', { assignmentMode: 'PARALLEL' })] }))).toEqual([]));

  it.each([
    ['a WAIT block', { steps: [step('w', 'WAIT')] }, 'NOT_IMPLEMENTED_WAIT_BLOCK'],
    ['a CALCULATOR block', { steps: [step('c', 'CALCULATOR')] }, 'NOT_IMPLEMENTED_CALCULATOR_BLOCK'],
    ['RANDOM_DISPATCH assignment', { steps: [step('t', 'TASK', { assignmentMode: 'RANDOM_DISPATCH' })] }, 'NOT_IMPLEMENTED_ASSIGNMENT_MODE'],
    ['a CUTOFF deadline', { steps: [step('t', 'TASK', { deadlineType: 'CUTOFF' })] }, 'NOT_IMPLEMENTED_CUTOFF_DEADLINE'],
    ['a required FILE field', { fields: [field('f', 's', 'F', { type: 'FILE', isRequired: true })] }, 'NOT_IMPLEMENTED_REQUIRED_FILE_FIELD'],
  ])('rejects %s', (_name, parts, code) => expect(codes(version(parts))).toEqual([code]));

  it('rejects conditions and amount rules on computed fields', () => {
    const doc = version({
      steps: [step('c', 'CONDITION')],
      transitions: [transition('t', 'c', 'c', 'CONDITION', { condition: [{ field: 'TOTAL', op: 'gt', value: 1 }] })],
      fields: [field('f', 'c', 'TOTAL', { type: 'FORMULA' })],
      amountRules: [amountRule('r', 'TOTAL')],
    });
    expect(codes(doc)).toEqual(['NOT_IMPLEMENTED_CONDITION_ON_COMPUTED_FIELD', 'NOT_IMPLEMENTED_AMOUNT_RULE_ON_COMPUTED_FIELD']);
  });

  describe('extra approval rules', () => {
    const base = { steps: [step('start', 'START'), step('extra', 'APPROVAL')] };
    const rule = (overrides = {}) => amountRule('r', 'A', { action: 'EXTRA_APPROVAL', approvalStepId: 'extra', stepId: 'start', ...overrides });
    it('need the SYSTEM_ONLY edge from the rule step to the approval step', () => {
      expect(codes(version({ ...base, transitions: [transition('sys', 'start', 'extra', 'SYSTEM_ONLY')], amountRules: [rule()] }))).toEqual([]);
      expect(codes(version({ ...base, transitions: [next('start', 'extra')], amountRules: [rule()] }))).toEqual(['AMOUNT_RULE_EXTRA_APPROVAL_NOT_WIRED']);
    });
    it('need a step', () => expect(codes(version({ ...base, amountRules: [rule({ stepId: null })] }))).toEqual(['AMOUNT_RULE_EXTRA_APPROVAL_NEEDS_STEP']));
    it('are ignored when inactive', () => expect(codes(version({ ...base, amountRules: [rule({ stepId: null, isActive: false })] }))).toEqual([]));
  });
});

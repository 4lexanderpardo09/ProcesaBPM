import { describe, expect, it } from 'vitest';
import { findEngineSupportProblems } from './engine-support.js';
import { amountRule, field, minimalFlow, next, step, transition, version } from './test-builders.js';

const codes = (doc: Parameters<typeof findEngineSupportProblems>[0]) => findEngineSupportProblems(doc).map((problem) => problem.code);

describe('findEngineSupportProblems', () => {
  it('accepts the minimal flow', () => expect(codes(minimalFlow())).toEqual([]));

  it.each(['PARALLEL', 'RANDOM_DISPATCH'] as const)('accepts %s assignment now', (mode) => expect(codes(version({ steps: [step('t', 'TASK', { assignmentMode: mode })] }))).toEqual([]));

  it.each([
    ['a WAIT block waiting for the company cutoff', { steps: [step('w', 'WAIT', { config: { mode: 'COMPANY_CUTOFF' } })] }, 'NOT_IMPLEMENTED_WAIT_COMPANY_CUTOFF'],
    ['a WEBHOOK block', { steps: [step('h', 'WEBHOOK')] }, 'NOT_IMPLEMENTED_WEBHOOK_BLOCK'],
    ['an EXPORT block', { steps: [step('e', 'EXPORT')] }, 'NOT_IMPLEMENTED_EXPORT_BLOCK'],
    ['a CUTOFF deadline', { steps: [step('t', 'TASK', { deadlineType: 'CUTOFF' })] }, 'NOT_IMPLEMENTED_CUTOFF_DEADLINE'],
  ])('rejects %s', (_name, parts, code) => expect(codes(version(parts))).toEqual([code]));

  it.each([{ mode: 'DURATION', value: 1, unit: 'BUSINESS_DAYS' }, { mode: 'UNTIL_FIELD_DATE', fieldCode: 'DUE', offsetBusinessDays: 0 }])('accepts a WAIT block with %j', (config) => expect(codes(version({ steps: [step('w', 'WAIT', { config })] }))).toEqual([]));

  it('accepts conditions and amount rules on computed fields', () => {
    const doc = version({
      steps: [step('c', 'CONDITION')],
      transitions: [transition('t', 'c', 'c', 'CONDITION', { condition: [{ field: 'TOTAL', op: 'gt', value: 1 }] })],
      fields: [field('f', 'c', 'TOTAL', { type: 'FORMULA' })],
      amountRules: [amountRule('r', 'TOTAL')],
    });
    expect(codes(doc)).toEqual([]);
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

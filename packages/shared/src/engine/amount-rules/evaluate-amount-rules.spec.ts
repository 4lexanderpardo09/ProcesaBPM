import { describe, expect, it } from 'vitest';
import { amountRule, field } from '../../workflow/test-builders.js';
import { evaluateAmountRules, type AmountScope } from './evaluate-amount-rules.js';

const scope: AmountScope = { stepId: 'start', companyId: 'company', positionId: 'cashier', companyCurrency: 'COP' };
const fields = new Map([
  ['AMOUNT', field('f1', 'start', 'AMOUNT', { type: 'CURRENCY' })],
  ['USD_AMOUNT', field('f2', 'start', 'USD_AMOUNT', { type: 'CURRENCY', config: { currencyCode: 'USD' } })],
  ['EXPENSES', field('f3', 'start', 'EXPENSES', { type: 'TABLE', config: { columns: [] } })],
]);
const run = (rules: ReturnType<typeof amountRule>[], values: Record<string, unknown>, override: Partial<AmountScope> = {}) => evaluateAmountRules(rules, fields, values, { ...scope, ...override });

describe('evaluateAmountRules', () => {
  it('lets amounts at or below the cap pass', () => expect(run([amountRule('r', 'AMOUNT')], { AMOUNT: 1000 })).toEqual({ blocks: [], warnings: [], diversion: undefined }));

  it('blocks with the rule message', () => expect(run([amountRule('r', 'AMOUNT', { message: 'Too much' })], { AMOUNT: 1000.01 }).blocks).toEqual(['Too much']));

  it('warns without stopping', () => {
    const result = run([amountRule('r', 'AMOUNT', { action: 'WARN', message: 'Check it' })], { AMOUNT: 2000 });
    expect(result.blocks).toEqual([]);
    expect(result.warnings).toEqual([{ ruleId: 'r', amount: '2000.00', max: '1000.00', message: 'Check it' }]);
  });

  it('diverts to the rule with the highest exceeded cap, lowest id on a tie', () => {
    const rules = [
      amountRule('b', 'AMOUNT', { action: 'EXTRA_APPROVAL', approvalStepId: 'x', maxAmount: '1000.00' }),
      amountRule('a', 'AMOUNT', { action: 'EXTRA_APPROVAL', approvalStepId: 'y', maxAmount: '1000.00' }),
      amountRule('c', 'AMOUNT', { action: 'EXTRA_APPROVAL', approvalStepId: 'z', maxAmount: '500.00' }),
    ];
    expect(run(rules, { AMOUNT: 5000 }).diversion?.id).toBe('a');
  });

  it('ignores rules of other steps, companies, positions and currencies, and inactive ones', () => {
    const rules = [
      amountRule('step', 'AMOUNT', { stepId: 'other' }),
      amountRule('company', 'AMOUNT', { companyId: 'other' }),
      amountRule('position', 'AMOUNT', { positionId: 'other' }),
      amountRule('currency', 'AMOUNT', { currencyCode: 'USD' }),
      amountRule('inactive', 'AMOUNT', { isActive: false }),
    ];
    expect(run(rules, { AMOUNT: 9999 }).blocks).toEqual([]);
  });

  it('applies rules scoped to the submitter position and step', () => {
    expect(run([amountRule('r', 'AMOUNT', { stepId: 'start', positionId: 'cashier', companyId: 'company' })], { AMOUNT: 9999 }).blocks).toHaveLength(1);
  });

  it('uses the currency of the field when it has one', () => {
    expect(run([amountRule('r', 'USD_AMOUNT', { currencyCode: 'USD' })], { USD_AMOUNT: 5000 }).blocks).toHaveLength(1);
    expect(run([amountRule('r', 'USD_AMOUNT', { currencyCode: 'COP' })], { USD_AMOUNT: 5000 }).blocks).toHaveLength(0);
  });

  it('skips fields nobody filled', () => expect(run([amountRule('r', 'AMOUNT')], {}).blocks).toEqual([]));

  describe('table fields', () => {
    const rows = [
      { KIND: 'Food', VALUE: 600 },
      { KIND: ' food ', VALUE: '500.50' },
      { KIND: 'Lodging', VALUE: 9000 },
    ];
    it('sums the amount column of the rows of the rule type, ignoring case and spaces', () => {
      const rule = amountRule('r', 'EXPENSES', { amountColumn: 'VALUE', typeColumn: 'KIND', rowTypeValue: 'FOOD' });
      expect(run([rule], { EXPENSES: rows }).blocks).toHaveLength(1);
      expect(run([{ ...rule, maxAmount: '1100.50' }], { EXPENSES: rows }).blocks).toHaveLength(0);
    });
    it('sums every row when there is no type column', () => {
      expect(run([amountRule('r', 'EXPENSES', { amountColumn: 'VALUE', maxAmount: '10100.50' })], { EXPENSES: rows }).blocks).toHaveLength(0);
      expect(run([amountRule('r', 'EXPENSES', { amountColumn: 'VALUE', maxAmount: '10100.49' })], { EXPENSES: rows }).blocks).toHaveLength(1);
    });
  });
});

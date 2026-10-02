import { describe, expect, it } from 'vitest';
import { InvalidStateError, NoMatchingBranchError, NotImplementedError } from '../../errors/domain-error.js';
import { field, next, step, transition, version } from '../../workflow/test-builders.js';
import { routeThroughAutomaticBlocks } from './route-through-automatic-blocks.js';

const branching = version({
  steps: [step('start', 'START'), step('check', 'CONDITION'), step('big', 'TASK'), step('small', 'TASK'), step('end', 'END')],
  transitions: [
    next('start', 'check'),
    transition('over', 'check', 'big', 'CONDITION', { condition: [{ field: 'AMOUNT', op: 'gt', value: 1000 }], sortOrder: 1 }),
    transition('fallback', 'check', 'small', 'DEFAULT', { sortOrder: 2 }),
    next('big', 'end', 'DECISION'),
    next('small', 'end', 'DECISION'),
  ],
});

describe('routeThroughAutomaticBlocks', () => {
  it('stops at the first people step', () => {
    const result = routeThroughAutomaticBlocks(branching, 'big', {});
    expect(result).toMatchObject({ hops: [], arrival: { stepId: 'big', kind: 'PEOPLE' }, changed: {}, failures: [] });
  });

  it('takes the branch whose condition holds', () => {
    const result = routeThroughAutomaticBlocks(branching, 'start', { AMOUNT: 5000 });
    expect(result.hops.map((hop) => [hop.stepId, hop.blockType, hop.transitionId])).toEqual([['start', 'START', 'start->check'], ['check', 'CONDITION', 'over']]);
    expect(result.arrival).toEqual({ stepId: 'big', kind: 'PEOPLE' });
  });

  it('falls back to the default branch, also when the value is missing', () => {
    expect(routeThroughAutomaticBlocks(branching, 'start', { AMOUNT: 10 }).arrival.stepId).toBe('small');
    expect(routeThroughAutomaticBlocks(branching, 'start', {}).arrival.stepId).toBe('small');
  });

  it('reaches the end', () => expect(routeThroughAutomaticBlocks(version({ steps: [step('e', 'END')] }), 'e', {}).arrival).toEqual({ stepId: 'e', kind: 'END' }));

  it('passes through side-effect blocks and reports them', () => {
    const doc = version({
      steps: [step('mail', 'NOTIFICATION'), step('pdf', 'DOCUMENT'), step('task', 'TASK')],
      transitions: [next('mail', 'pdf'), next('pdf', 'task')],
    });
    expect(routeThroughAutomaticBlocks(doc, 'mail', {}).hops.map((hop) => hop.blockType)).toEqual(['NOTIFICATION', 'DOCUMENT']);
  });

  it('still refuses WAIT blocks, and CALCULATOR blocks when it has no context to run them', () => {
    for (const type of ['WAIT', 'CALCULATOR'] as const) {
      const doc = version({ steps: [step('b', type), step('t', 'TASK')], transitions: [next('b', 't')] });
      expect(() => routeThroughAutomaticBlocks(doc, 'b', {})).toThrow(NotImplementedError);
    }
  });

  describe('CALCULATOR blocks', () => {
    const meals = { meals: [{ code: 'LUNCH', from: '12:00', to: '14:00', amount: '15000' }] };
    const context = { today: '2026-10-05', timeZone: 'America/Bogota', calculatorConfigs: new Map([['MEAL_ALLOWANCE', meals]]) };
    const doc = version({
      steps: [step('start', 'START'), step('calc', 'CALCULATOR', { config: { calculatorCode: 'MEAL_ALLOWANCE', inputs: { departure: 'LEAVES', return: 'BACK' }, outputFieldCode: 'ALLOWANCE' } }), step('check', 'CONDITION'), step('boss', 'TASK'), step('clerk', 'TASK')],
      transitions: [
        next('start', 'calc'),
        next('calc', 'check'),
        transition('big', 'check', 'boss', 'CONDITION', { condition: [{ field: 'DOUBLE', op: 'gt', value: 20000 }], sortOrder: 1 }),
        transition('small', 'check', 'clerk', 'DEFAULT', { sortOrder: 2 }),
      ],
      fields: [
        field('a', 'start', 'LEAVES', { type: 'DATETIME' }),
        field('b', 'start', 'BACK', { type: 'DATETIME' }),
        field('c', 'start', 'ALLOWANCE', { type: 'CURRENCY', isReadOnly: true }),
        field('d', 'start', 'DOUBLE', { type: 'FORMULA', config: { expression: 'ALLOWANCE * 2', resultType: 'CURRENCY' } }),
      ],
    });
    const trip = { LEAVES: '2026-10-05T16:00:00.000Z', BACK: '2026-10-05T20:00:00.000Z' };

    it('stores the result, recalculates the formulas and routes on the new values', () => {
      const result = routeThroughAutomaticBlocks(doc, 'start', trip, context);
      expect(result.changed).toEqual({ ALLOWANCE: 15000, DOUBLE: 30000 });
      expect(result.arrival.stepId).toBe('boss');
      expect(result.hops.map((hop) => hop.blockType)).toEqual(['START', 'CALCULATOR', 'CONDITION']);
      expect(result.failures).toEqual([]);
    });

    it('stores a blank and reports the failure when the calculator cannot produce a value', () => {
      const result = routeThroughAutomaticBlocks(doc, 'start', { LEAVES: trip.BACK, BACK: trip.LEAVES }, context);
      expect(result.failures).toEqual([{ fieldCode: 'ALLOWANCE', reason: 'ARGUMENT_OUT_OF_RANGE', strict: false }]);
      expect(result.arrival.stepId).toBe('clerk');
    });

    it('reports a calculator the tenant has not configured', () => {
      const result = routeThroughAutomaticBlocks(doc, 'start', trip, { ...context, calculatorConfigs: new Map() });
      expect(result.failures).toEqual([{ fieldCode: 'ALLOWANCE', reason: 'CALCULATOR_NOT_CONFIGURED', strict: false }]);
    });

    it('does not change the values it was given', () => {
      const input = { ...trip };
      routeThroughAutomaticBlocks(doc, 'start', input, context);
      expect(input).toEqual(trip);
    });
  });

  it('fails when a condition block has no exit', () => {
    expect(() => routeThroughAutomaticBlocks(version({ steps: [step('c', 'CONDITION')] }), 'c', {})).toThrow(NoMatchingBranchError);
  });

  it('refuses endless loops of automatic blocks', () => {
    const doc = version({ steps: [step('a', 'NOTIFICATION'), step('b', 'NOTIFICATION')], transitions: [next('a', 'b'), next('b', 'a')] });
    expect(() => routeThroughAutomaticBlocks(doc, 'a', {})).toThrow(InvalidStateError);
  });
});

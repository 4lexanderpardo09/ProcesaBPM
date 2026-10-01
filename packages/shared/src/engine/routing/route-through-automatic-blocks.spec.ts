import { describe, expect, it } from 'vitest';
import { InvalidStateError, NoMatchingBranchError, NotImplementedError } from '../../errors/domain-error.js';
import { next, step, transition, version } from '../../workflow/test-builders.js';
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
    expect(result).toEqual({ hops: [], arrival: { stepId: 'big', kind: 'PEOPLE' } });
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

  it.each(['WAIT', 'CALCULATOR'] as const)('refuses %s blocks', (type) => {
    const doc = version({ steps: [step('b', type), step('t', 'TASK')], transitions: [next('b', 't')] });
    expect(() => routeThroughAutomaticBlocks(doc, 'b', {})).toThrow(NotImplementedError);
  });

  it('fails when a condition block has no exit', () => {
    expect(() => routeThroughAutomaticBlocks(version({ steps: [step('c', 'CONDITION')] }), 'c', {})).toThrow(NoMatchingBranchError);
  });

  it('refuses endless loops of automatic blocks', () => {
    const doc = version({ steps: [step('a', 'NOTIFICATION'), step('b', 'NOTIFICATION')], transitions: [next('a', 'b'), next('b', 'a')] });
    expect(() => routeThroughAutomaticBlocks(doc, 'a', {})).toThrow(InvalidStateError);
  });
});

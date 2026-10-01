import { InvalidStateError, type WorkflowVersionDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { parallelExits, parallelOutcome, pickSignerHolder } from './parallel-policy.js';

const doc = (types: string[]) => ({ steps: [], fields: [], amountRules: [], transitions: types.map((type, index) => ({ id: `t${index}`, fromStepId: 's', toStepId: `n${index}`, type })) }) as unknown as WorkflowVersionDocument;

describe('parallelExits', () => {
  it('finds the DECISION and the optional SYSTEM_ONLY', () => {
    expect(parallelExits(doc(['DECISION']), 's')).toMatchObject({ approval: { id: 't0' }, rejection: null });
    expect(parallelExits(doc(['SYSTEM_ONLY', 'DECISION']), 's')).toMatchObject({ approval: { id: 't1' }, rejection: { id: 't0' } });
  });
  it('needs exactly one DECISION', () => {
    expect(() => parallelExits(doc([]), 's')).toThrow(InvalidStateError);
    expect(() => parallelExits(doc(['DECISION', 'DECISION']), 's')).toThrow(InvalidStateError);
  });
});

describe('parallelOutcome', () => {
  const tasks = [
    { userId: 'a', status: 'PENDING' as const },
    { userId: 'b', status: 'PENDING' as const },
    { userId: 'c', status: 'SIGNED' as const },
  ];
  it('waits while others are pending', () => expect(parallelOutcome(tasks, 'a', 'SIGN')).toEqual({ kind: 'WAIT' }));
  it('the last signature approves', () => expect(parallelOutcome([{ userId: 'a', status: 'PENDING' }, { userId: 'c', status: 'SIGNED' }], 'a', 'SIGN')).toEqual({ kind: 'APPROVED' }));
  it('the first rejection decides and cancels the pending ones', () => expect(parallelOutcome(tasks, 'a', 'REJECT')).toEqual({ kind: 'REJECTED', cancelUserIds: ['b'] }));
  it('a lone signer approves at once', () => expect(parallelOutcome([{ userId: 'a', status: 'PENDING' }], 'a', 'SIGN')).toEqual({ kind: 'APPROVED' }));
});

describe('pickSignerHolder', () => {
  it('prefers the least loaded, then the lowest id', () => {
    expect(pickSignerHolder(['c', 'b', 'a'], new Map([['a', 3], ['b', 1], ['c', 1]]))).toBe('b');
    expect(pickSignerHolder(['b', 'a'], new Map())).toBe('a');
  });
});

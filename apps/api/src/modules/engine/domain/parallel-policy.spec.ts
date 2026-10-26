import { InvalidStateError, type WorkflowVersionDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { type ParallelStatus, parallelExits, parallelOutcome, type PreviousSignature, type SignerAssignment, signatureRound } from './parallel-policy.js';

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


describe('signatureRound', () => {
  const at = new Date('2026-10-26T15:00:00Z');
  const areas: SignerAssignment[] = [
    { userId: 'boss', signerId: 'S-boss' },
    { userId: 'assets', signerId: 'S-assets' },
    { userId: 'it', signerId: 'S-it' },
  ];
  const previous = (status: Record<string, ParallelStatus>): PreviousSignature[] =>
    areas.map((area) => ({ ...area, status: status[area.userId] ?? 'CANCELLED', completedAt: status[area.userId] === 'PENDING' ? null : at, comment: null }));

  it('a first round, or a way back that was not a rejection, asks everybody', () => {
    expect(signatureRound(areas, [])).toEqual({ pending: areas, kept: [] });
    expect(signatureRound(areas, previous({ boss: 'SIGNED', assets: 'SIGNED', it: 'SIGNED' }))).toEqual({ pending: areas, kept: [] });
  });

  it('after a rejection, the areas that signed stay signed; the rejected and the cancelled sign again', () => {
    const round = signatureRound(areas, previous({ boss: 'SIGNED', it: 'REJECTED' }));
    expect(round.kept.map((signature) => signature.userId)).toEqual(['boss']);
    expect(round.pending).toEqual([areas[1], areas[2]]);
  });

  it('a signature stands for its area even if the area now resolves to somebody else', () => {
    const now = [{ userId: 'new-boss', signerId: 'S-boss' }, ...areas.slice(1)];
    expect(signatureRound(now, previous({ boss: 'SIGNED', it: 'REJECTED' })).kept.map((signature) => signature.userId)).toEqual(['boss']);
  });

  it('a signature without an area (added on reassignment) stands for the same person', () => {
    const added: PreviousSignature = { userId: 'extra', signerId: null, status: 'SIGNED', completedAt: at, comment: null };
    const round = signatureRound([...areas, { userId: 'extra', signerId: null }], [...previous({ it: 'REJECTED' }), added]);
    expect(round.kept).toEqual([added]);
  });

  it('nobody is asked twice, and a round with nothing left to sign starts in full', () => {
    const twice = [areas[0]!, { userId: 'boss', signerId: 'S-audit' }, areas[2]!];
    expect(signatureRound(twice, previous({ boss: 'SIGNED', it: 'REJECTED' })).pending).toEqual([areas[2]]);
    expect(signatureRound([areas[0]!], previous({ boss: 'SIGNED', it: 'REJECTED' }))).toEqual({ pending: [areas[0]], kept: [] });
  });
});

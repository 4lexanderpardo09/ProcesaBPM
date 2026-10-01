import { AssigneeSelectionRequiredError, InvalidAssigneeError, InvalidStateError, NoAssigneeCandidatesError, NotImplementedError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { type AssignmentInput, decideAssignees } from './assignment-policy.js';

const person = (id: string) => ({ userId: id, name: id });
const run = (overrides: Partial<AssignmentInput> = {}) => decideAssignees({ stepId: 's', mode: 'POSITION', manualSelection: false, candidates: [person('a')], chosenId: undefined, ...overrides });

describe('decideAssignees', () => {
  it.each(['POSITION', 'USERS', 'GROUP'] as const)('%s with one candidate assigns them', (mode) => expect(run({ mode })).toEqual({ type: 'PRIMARY', userIds: ['a'] }));

  it.each(['POSITION', 'USERS', 'GROUP'] as const)('%s with several candidates and no manual selection is a pool, never an arbitrary pick', (mode) =>
    expect(run({ mode, candidates: [person('a'), person('b')] })).toEqual({ type: 'POOL', userIds: ['a', 'b'] }));

  it('POOL always makes a pool, even of one', () => expect(run({ mode: 'POOL' })).toEqual({ type: 'POOL', userIds: ['a'] }));

  it.each(['CREATOR', 'APPROVER'] as const)('%s assigns the resolved person and ignores manual selection', (mode) =>
    expect(run({ mode, manualSelection: true, chosenId: 'zzz' })).toEqual({ type: 'PRIMARY', userIds: ['a'] }));

  describe('manual selection', () => {
    const several = { manualSelection: true, candidates: [person('a'), person('b')] };
    it('assigns the chosen candidate', () => expect(run({ ...several, chosenId: 'b' })).toEqual({ type: 'PRIMARY', userIds: ['b'] }));
    it('asks for a choice listing the candidates', () => {
      const error = (() => { try { run(several); } catch (caught) { return caught; } })();
      expect(error).toBeInstanceOf(AssigneeSelectionRequiredError);
      expect((error as AssigneeSelectionRequiredError).details).toEqual({ stepId: 's', candidates: several.candidates });
    });
    it('rejects someone who is not a candidate', () => expect(() => run({ ...several, chosenId: 'intruder' })).toThrow(InvalidAssigneeError));
    it('does not ask when there is a single candidate, but still rejects a wrong choice', () => {
      expect(run({ manualSelection: true })).toEqual({ type: 'PRIMARY', userIds: ['a'] });
      expect(() => run({ manualSelection: true, chosenId: 'intruder' })).toThrow(InvalidAssigneeError);
    });
    it('ignores the chosen id when the step is not manual', () => expect(run({ candidates: [person('a'), person('b')], chosenId: 'a' }).type).toBe('POOL'));
  });

  it('fails without candidates', () => expect(() => run({ candidates: [] })).toThrow(NoAssigneeCandidatesError));
  it('PARALLEL steps resolve signers elsewhere: the candidate policy refuses them', () => expect(() => run({ mode: 'PARALLEL' })).toThrow(NotImplementedError));
  it('RANDOM_DISPATCH leaves the ticket waiting, but only if there is somebody to hand it to', () => {
    expect(run({ mode: 'RANDOM_DISPATCH' })).toEqual({ type: 'DISPATCH', userIds: [] });
    expect(() => run({ mode: 'RANDOM_DISPATCH', candidates: [] })).toThrow(NoAssigneeCandidatesError);
  });
  it('NONE has no assignees', () => expect(() => run({ mode: 'NONE' })).toThrow(InvalidStateError));
});

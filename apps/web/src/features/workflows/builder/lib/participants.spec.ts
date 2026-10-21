import { describe, expect, it } from 'vitest';
import { fromCandidates, fromInitiators, fromRecipients, toCandidates, toInitiators } from './participants';

describe('participants', () => {
  it('reads candidates and initiators as kind and id', () => {
    expect(fromCandidates([{ id: 'c', participantType: 'GROUP', userId: null, positionId: null, groupId: 'g' }])).toEqual([{ kind: 'GROUP', id: 'g' }]);
    expect(fromInitiators([{ id: 'i', participantType: 'COMPANY', userId: null, positionId: null, groupId: null, departmentId: null, companyId: 'co', siteId: null }])).toEqual([{ kind: 'COMPANY', id: 'co' }]);
  });

  it('writes the bodies the API takes, each kind with its own key', () => {
    expect(toCandidates([{ kind: 'USER', id: 'u' }, { kind: 'POSITION', id: 'p' }, { kind: 'SITE', id: 's' }])).toEqual({ candidates: [{ participantType: 'USER', userId: 'u' }, { participantType: 'POSITION', positionId: 'p' }] });
    expect(toInitiators([{ kind: 'DEPARTMENT', id: 'd' }])).toEqual({ initiators: [{ participantType: 'DEPARTMENT', departmentId: 'd' }] });
  });

  it('keeps only the specific recipients of a notification', () => {
    expect(fromRecipients([{ kind: 'CREATOR' }, { kind: 'GROUP', id: 'g' }])).toEqual([{ kind: 'GROUP', id: 'g' }]);
  });
});

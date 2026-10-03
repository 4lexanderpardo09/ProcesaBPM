import { describe, expect, it } from 'vitest';
import { namedIds, resolveBlockRecipients, type RecipientSources } from './block-recipients.js';

const sources: RecipientSources = {
  creatorId: 'creator',
  assigneeIds: ['worker-b', 'worker-a'],
  observerIds: ['watcher'],
  positionMembers: new Map([['p1', ['pos-1', 'worker-a']]]),
  groupMembers: new Map([['g1', ['grp-1', 'creator']]]),
};

describe('resolveBlockRecipients', () => {
  it('resolves every kind of recipient', () => {
    const ids = resolveBlockRecipients(
      [{ kind: 'CREATOR' }, { kind: 'ASSIGNEES' }, { kind: 'OBSERVERS' }, { kind: 'USER', id: 'named' }, { kind: 'POSITION', id: 'p1' }, { kind: 'GROUP', id: 'g1' }],
      sources,
    );
    expect(ids).toEqual(['creator', 'grp-1', 'named', 'pos-1', 'watcher', 'worker-a', 'worker-b']);
  });

  it('names each person once, in a stable order, whatever the order of the recipients', () => {
    expect(resolveBlockRecipients([{ kind: 'GROUP', id: 'g1' }, { kind: 'CREATOR' }, { kind: 'CREATOR' }], sources)).toEqual(['creator', 'grp-1']);
  });

  it('a position or group nobody belongs to names nobody', () => {
    expect(resolveBlockRecipients([{ kind: 'POSITION', id: 'empty' }, { kind: 'GROUP', id: 'empty' }], sources)).toEqual([]);
  });
});

describe('namedIds', () => {
  it('lists the distinct ids of one kind', () => {
    const recipients = [{ kind: 'POSITION', id: 'p1' }, { kind: 'POSITION', id: 'p1' }, { kind: 'GROUP', id: 'g1' }, { kind: 'CREATOR' }] as const;
    expect(namedIds(recipients, 'POSITION')).toEqual(['p1']);
    expect(namedIds(recipients, 'GROUP')).toEqual(['g1']);
  });
});

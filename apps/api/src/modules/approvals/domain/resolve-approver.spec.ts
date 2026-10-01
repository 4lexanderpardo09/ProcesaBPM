import type { ApproverNotFound, ApproverResolution } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { type ApprovalSnapshot, type ApproverCandidate, type DelegationSnapshot, type GroupSnapshot, resolveApprover } from './resolve-approver.js';

// ---- A tiny language to describe a snapshot ----
interface GroupSpec {
  readonly id: string;
  readonly scope?: 'COMPANY' | 'GENERAL';
  readonly active?: boolean;
  /** Members of the group (the people whose approvers it holds). */
  readonly members: readonly string[];
  /** Approvers in the order given; a leading `!` marks one as not eligible. */
  readonly approvers: readonly string[];
}

function snapshot(groups: readonly GroupSpec[], delegations: Record<string, string | { to: string; eligible: boolean }> = {}): ApprovalSnapshot {
  const groupMap = new Map<string, GroupSnapshot>();
  const memberGroups = new Map<string, { company?: string; general?: string }>();
  for (const spec of groups) {
    const scope = spec.scope ?? 'COMPANY';
    const approvers: ApproverCandidate[] = spec.approvers.map((name, index) => ({
      userId: name.replace('!', ''),
      position: index + 1,
      eligible: !name.startsWith('!'),
    }));
    groupMap.set(spec.id, { id: spec.id, scope, active: spec.active ?? true, approvers });
    for (const member of spec.members) {
      const entry = memberGroups.get(member) ?? {};
      memberGroups.set(member, scope === 'COMPANY' ? { ...entry, company: spec.id } : { ...entry, general: spec.id });
    }
  }
  const delegationMap = new Map<string, DelegationSnapshot>(
    Object.entries(delegations).map(([from, to]) => [from, typeof to === 'string' ? { toUserId: to, toEligible: true } : { toUserId: to.to, toEligible: to.eligible }]),
  );
  return { memberGroups, groups: groupMap, delegations: delegationMap };
}

const resolved = (outcome: ReturnType<typeof resolveApprover>): ApproverResolution => {
  expect(outcome.found).toBe(true);
  return outcome as ApproverResolution;
};
const missing = (outcome: ReturnType<typeof resolveApprover>): ApproverNotFound => {
  expect(outcome.found).toBe(false);
  return outcome as ApproverNotFound;
};

describe('resolveApprover: which group', () => {
  it('the company group, position 1', () => {
    const outcome = resolved(resolveApprover(snapshot([{ id: 'g', members: ['creator'], approvers: ['boss', 'deputy'] }]), 'creator', 1));
    expect(outcome).toMatchObject({ approverId: 'boss', onBehalfOfId: null, groupId: 'g', scope: 'COMPANY', level: 1 });
  });

  it('without a company group, the general one', () => {
    const outcome = resolved(resolveApprover(snapshot([{ id: 'general', scope: 'GENERAL', members: ['creator'], approvers: ['boss'] }]), 'creator', 1));
    expect(outcome).toMatchObject({ approverId: 'boss', scope: 'GENERAL' });
  });

  it('when both exist the company group wins', () => {
    const groups: GroupSpec[] = [
      { id: 'general', scope: 'GENERAL', members: ['creator'], approvers: ['general-boss'] },
      { id: 'company', members: ['creator'], approvers: ['company-boss'] },
    ];
    expect(resolved(resolveApprover(snapshot(groups), 'creator', 1))).toMatchObject({ approverId: 'company-boss', groupId: 'company' });
  });

  it('an inactive company group is ignored in favour of the general one', () => {
    const groups: GroupSpec[] = [
      { id: 'company', active: false, members: ['creator'], approvers: ['company-boss'] },
      { id: 'general', scope: 'GENERAL', members: ['creator'], approvers: ['general-boss'] },
    ];
    expect(resolved(resolveApprover(snapshot(groups), 'creator', 1))).toMatchObject({ approverId: 'general-boss', scope: 'GENERAL' });
  });

  it('being an approver of a group does not make a person a member of it', () => {
    const outcome = missing(resolveApprover(snapshot([{ id: 'g', members: ['someone-else'], approvers: ['creator', 'boss'] }]), 'creator', 1));
    expect(outcome.reason).toBe('NO_GROUP');
  });

  it('no group at all: NO_GROUP with an empty trace', () => {
    const outcome = missing(resolveApprover(snapshot([]), 'creator', 1));
    expect(outcome).toMatchObject({ reason: 'NO_GROUP', level: 1, subjectId: 'creator' });
    expect(outcome.chain[0]!.groupsTried).toEqual([]);
  });

  it('only inactive groups count as no group', () => {
    expect(missing(resolveApprover(snapshot([{ id: 'g', active: false, members: ['creator'], approvers: ['boss'] }]), 'creator', 1)).reason).toBe('NO_GROUP');
  });
});

describe('resolveApprover: order and eligibility', () => {
  it('takes the lowest position, whatever order the rows arrive in', () => {
    const base = snapshot([{ id: 'g', members: ['creator'], approvers: ['first', 'second'] }]);
    const shuffled: ApprovalSnapshot = {
      ...base,
      groups: new Map([['g', { id: 'g', scope: 'COMPANY', active: true, approvers: [{ userId: 'second', position: 2, eligible: true }, { userId: 'first', position: 1, eligible: true }] }]]),
    };
    expect(resolved(resolveApprover(shuffled, 'creator', 1)).approverId).toBe('first');
  });

  it('skips inactive approvers', () => {
    const outcome = resolved(resolveApprover(snapshot([{ id: 'g', members: ['creator'], approvers: ['!away', 'deputy'] }]), 'creator', 1));
    expect(outcome.approverId).toBe('deputy');
    expect(outcome.chain[0]!.groupsTried[0]!.skipped).toEqual([{ userId: 'away', reason: 'INACTIVE' }]);
  });

  it('nobody active anywhere: NO_ACTIVE_APPROVER', () => {
    const groups: GroupSpec[] = [
      { id: 'company', members: ['creator'], approvers: ['!a'] },
      { id: 'general', scope: 'GENERAL', members: ['creator'], approvers: ['!b'] },
    ];
    expect(missing(resolveApprover(snapshot(groups), 'creator', 1)).reason).toBe('NO_ACTIVE_APPROVER');
  });

  it('a group with no approvers at all is NO_ACTIVE_APPROVER, not NO_GROUP', () => {
    expect(missing(resolveApprover(snapshot([{ id: 'g', members: ['creator'], approvers: [] }]), 'creator', 1)).reason).toBe('NO_ACTIVE_APPROVER');
  });
});

describe('resolveApprover: delegation', () => {
  it('the delegate acts and the nominal approver is reported', () => {
    const outcome = resolved(resolveApprover(snapshot([{ id: 'g', members: ['creator'], approvers: ['boss'] }], { boss: 'delegate' }), 'creator', 1));
    expect(outcome).toMatchObject({ approverId: 'delegate', onBehalfOfId: 'boss' });
  });

  it('an inactive delegate skips the position, and the absent approver is not used instead', () => {
    const outcome = resolved(resolveApprover(snapshot([{ id: 'g', members: ['creator'], approvers: ['boss', 'deputy'] }], { boss: { to: 'delegate', eligible: false } }), 'creator', 1));
    expect(outcome.approverId).toBe('deputy');
    expect(outcome.chain[0]!.groupsTried[0]!.skipped).toEqual([{ userId: 'boss', reason: 'DELEGATE_INACTIVE' }]);
  });

  it('a delegate who is the creator skips the position', () => {
    const outcome = resolved(resolveApprover(snapshot([{ id: 'g', members: ['creator'], approvers: ['boss', 'deputy'] }], { boss: 'creator' }), 'creator', 1));
    expect(outcome.approverId).toBe('deputy');
    expect(outcome.chain[0]!.groupsTried[0]!.skipped).toEqual([{ userId: 'boss', reason: 'DELEGATE_IS_SELF' }]);
  });

  it('delegations do not chain', () => {
    const outcome = resolved(resolveApprover(snapshot([{ id: 'g', members: ['creator'], approvers: ['boss'] }], { boss: 'delegate', delegate: 'second-delegate' }), 'creator', 1));
    expect(outcome.approverId).toBe('delegate');
  });

  it('a delegate who is the subject of the level is self-approval by proxy, not a free pass', () => {
    const groups: GroupSpec[] = [
      { id: 'g1', members: ['creator'], approvers: ['a'] },
      { id: 'g2', members: ['a'], approvers: ['b'] },
    ];
    // Level 2 would delegate to `a`, whose approver it is looking for.
    expect(missing(resolveApprover(snapshot(groups, { b: 'a' }), 'creator', 2))).toMatchObject({ reason: 'SELF_APPROVAL_ONLY', level: 2 });
  });

  it('a delegate from an earlier level is a cycle', () => {
    const groups: GroupSpec[] = [
      { id: 'g1', members: ['creator'], approvers: ['a'] },
      { id: 'g2', members: ['a'], approvers: ['b'] },
      { id: 'g3', members: ['b'], approvers: ['c'] },
    ];
    expect(missing(resolveApprover(snapshot(groups, { c: 'a' }), 'creator', 3))).toMatchObject({ reason: 'APPROVAL_CYCLE', level: 3 });
  });

  it('the delegate of a boss who is also the creator is not used (self-approval by proxy)', () => {
    const outcome = missing(resolveApprover(snapshot([{ id: 'g', members: ['creator'], approvers: ['creator'] }], { creator: 'delegate' }), 'creator', 1));
    expect(outcome.reason).toBe('SELF_APPROVAL_ONLY');
  });
});

describe('resolveApprover: self-approval', () => {
  it('the creator as position 1 passes the turn to position 2', () => {
    expect(resolved(resolveApprover(snapshot([{ id: 'g', members: ['creator'], approvers: ['creator', 'deputy'] }]), 'creator', 1)).approverId).toBe('deputy');
  });

  it('the creator as the only approver of the company group goes up to the general group', () => {
    const groups: GroupSpec[] = [
      { id: 'company', members: ['creator'], approvers: ['creator'] },
      { id: 'general', scope: 'GENERAL', members: ['creator'], approvers: ['director'] },
    ];
    const outcome = resolved(resolveApprover(snapshot(groups), 'creator', 1));
    expect(outcome).toMatchObject({ approverId: 'director', scope: 'GENERAL' });
    expect(outcome.chain[0]!.groupsTried.map((group) => group.groupId)).toEqual(['company', 'general']);
  });

  it('the creator as the only approver everywhere: SELF_APPROVAL_ONLY', () => {
    const groups: GroupSpec[] = [
      { id: 'company', members: ['creator'], approvers: ['creator'] },
      { id: 'general', scope: 'GENERAL', members: ['creator'], approvers: ['creator'] },
    ];
    expect(missing(resolveApprover(snapshot(groups), 'creator', 1)).reason).toBe('SELF_APPROVAL_ONLY');
  });
});

describe('resolveApprover: several levels', () => {
  const chain: GroupSpec[] = [
    { id: 'g-creator', members: ['creator'], approvers: ['lead'] },
    { id: 'g-lead', members: ['lead'], approvers: ['manager'] },
    { id: 'g-manager', members: ['manager'], approvers: ['director'] },
  ];

  it('level 2 is the approver of the level 1 approver, level 3 the next one', () => {
    expect(resolved(resolveApprover(snapshot(chain), 'creator', 1)).approverId).toBe('lead');
    expect(resolved(resolveApprover(snapshot(chain), 'creator', 2)).approverId).toBe('manager');
    const third = resolved(resolveApprover(snapshot(chain), 'creator', 3));
    expect(third.approverId).toBe('director');
    expect(third.chain.map((level) => level.subjectId)).toEqual(['creator', 'lead', 'manager']);
  });

  it('the chain follows the nominal approver, not the delegate', () => {
    const outcome = resolved(resolveApprover(snapshot(chain, { lead: 'substitute' }), 'creator', 2));
    expect(outcome.approverId).toBe('manager');
    expect(outcome.chain[0]!.resolved).toMatchObject({ approverId: 'substitute', onBehalfOfId: 'lead' });
  });

  it('a level that finds nobody reports that level and its subject', () => {
    const outcome = missing(resolveApprover(snapshot(chain), 'creator', 4));
    expect(outcome).toMatchObject({ reason: 'NO_GROUP', level: 4, subjectId: 'director' });
    expect(outcome.chain).toHaveLength(4);
  });

  it('the original creator can come back as an approver at level 3 and is skipped', () => {
    const groups: GroupSpec[] = [
      { id: 'g1', members: ['creator'], approvers: ['a'] },
      { id: 'g2', members: ['a'], approvers: ['b'] },
      { id: 'g3', members: ['b'], approvers: ['creator', 'c'] },
    ];
    expect(resolved(resolveApprover(snapshot(groups), 'creator', 3)).approverId).toBe('c');
  });

  const ab: GroupSpec[] = [
    { id: 'g-a', members: ['a'], approvers: ['b'] },
    { id: 'g-b', members: ['b'], approvers: ['a'] },
  ];

  it('A approves B and B approves A, ticket created by B: level 2 ends (self-approval) instead of looping', () => {
    expect(resolved(resolveApprover(snapshot(ab), 'b', 1)).approverId).toBe('a');
    expect(missing(resolveApprover(snapshot(ab), 'b', 2))).toMatchObject({ reason: 'SELF_APPROVAL_ONLY', level: 2, subjectId: 'a' });
  });

  it('A approves B and B approves A, ticket created by someone else: the third level ends with APPROVAL_CYCLE', () => {
    const groups: GroupSpec[] = [...ab, { id: 'g-c', members: ['creator'], approvers: ['a'] }];
    expect(resolved(resolveApprover(snapshot(groups), 'creator', 2)).approverId).toBe('b');
    expect(missing(resolveApprover(snapshot(groups), 'creator', 3))).toMatchObject({ reason: 'APPROVAL_CYCLE', level: 3, subjectId: 'b' });
  });

  it('a cycle with a spare approver moves on to the next position', () => {
    const groups: GroupSpec[] = [
      { id: 'g-c', members: ['creator'], approvers: ['a'] },
      { id: 'g-a', members: ['a'], approvers: ['b'] },
      { id: 'g-b', members: ['b'], approvers: ['a', 'spare'] },
    ];
    expect(resolved(resolveApprover(snapshot(groups), 'creator', 3)).approverId).toBe('spare');
  });

  it('a person who is the only approver of their own group at level 2 is self-approval, not a cycle', () => {
    const groups: GroupSpec[] = [
      { id: 'g1', members: ['creator'], approvers: ['a'] },
      { id: 'g2', members: ['a'], approvers: ['a'] },
    ];
    expect(missing(resolveApprover(snapshot(groups), 'creator', 2))).toMatchObject({ reason: 'SELF_APPROVAL_ONLY', level: 2, subjectId: 'a' });
  });

  it('a long ring terminates within the requested levels', () => {
    const ring = ['a', 'b', 'c', 'd', 'e'].map((name, index, all) => ({ id: `g-${name}`, members: [name], approvers: [all[(index + 1) % all.length]!] }));
    const groups: GroupSpec[] = [{ id: 'g-z', members: ['creator'], approvers: ['a'] }, ...ring];
    const outcome = missing(resolveApprover(snapshot(groups), 'creator', 20));
    expect(outcome.reason).toBe('APPROVAL_CYCLE');
    expect(outcome.level).toBe(6);
  });
});

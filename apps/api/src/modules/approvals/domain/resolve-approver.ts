import type { ApprovalScope, ApproverOutcome, ApproverNotFoundReason, GroupTrace, LevelTrace, SkipReason } from '@procesabpm/shared';

export interface ApproverCandidate {
  readonly userId: string;
  readonly position: number;
  /** An active member of the tenant whose account is not disabled. */
  readonly eligible: boolean;
}

export interface GroupSnapshot {
  readonly id: string;
  readonly scope: ApprovalScope;
  readonly active: boolean;
  readonly approvers: readonly ApproverCandidate[];
}

/** The delegation of an approver that is in force at the instant being resolved. */
export interface DelegationSnapshot {
  readonly toUserId: string;
  readonly toEligible: boolean;
}

/**
 * Everything the resolver reads, for one (type, company, instant). Loaded in a few queries by the
 * repository; the resolution itself is pure, so tables of cases can test it without a database.
 */
export interface ApprovalSnapshot {
  /** The group (of the type) each person belongs to as a member: one for the company, one general, at most. */
  readonly memberGroups: ReadonlyMap<string, { readonly company?: string; readonly general?: string }>;
  readonly groups: ReadonlyMap<string, GroupSnapshot>;
  readonly delegations: ReadonlyMap<string, DelegationSnapshot>;
}

interface LevelResult {
  readonly nominalId: string;
  readonly effectiveId: string;
  readonly groupId: string;
  readonly scope: ApprovalScope;
}

/** Candidate groups of a subject, the company's before the general one. */
function candidateGroups(snapshot: ApprovalSnapshot, subjectId: string): GroupSnapshot[] {
  const own = snapshot.memberGroups.get(subjectId);
  return [own?.company, own?.general]
    .map((id) => (id === undefined ? undefined : snapshot.groups.get(id)))
    .filter((group): group is GroupSnapshot => group !== undefined && group.active);
}

/**
 * First usable approver of one group, in position order. A candidate is checked against the people
 * already in the chain before their delegation is looked at, so nobody approves their own ticket,
 * neither directly nor through a delegate, and cycles cannot come back.
 */
function pickFromGroup(snapshot: ApprovalSnapshot, group: GroupSnapshot, creatorId: string, subjectId: string, visited: ReadonlySet<string>): { result?: LevelResult; trace: GroupTrace } {
  const skipped: Array<{ userId: string; reason: SkipReason }> = [];
  const passOver = (userId: string, reason: SkipReason) => skipped.push({ userId, reason });
  const ordered = [...group.approvers].sort((a, b) => a.position - b.position);

  for (const approver of ordered) {
    if (!approver.eligible) {
      passOver(approver.userId, 'INACTIVE');
      continue;
    }
    if (visited.has(approver.userId)) {
      passOver(approver.userId, approver.userId === creatorId || approver.userId === subjectId ? 'SELF' : 'CHAIN');
      continue;
    }
    const delegation = snapshot.delegations.get(approver.userId);
    if (delegation === undefined) {
      return { result: { nominalId: approver.userId, effectiveId: approver.userId, groupId: group.id, scope: group.scope }, trace: { groupId: group.id, scope: group.scope, skipped } };
    }
    // The approver is away: their delegate acts, and never the approver. Delegations do not chain.
    if (!delegation.toEligible) {
      passOver(approver.userId, 'DELEGATE_INACTIVE');
      continue;
    }
    if (visited.has(delegation.toUserId)) {
      passOver(approver.userId, delegation.toUserId === creatorId || delegation.toUserId === subjectId ? 'DELEGATE_IS_SELF' : 'CHAIN');
      continue;
    }
    return { result: { nominalId: approver.userId, effectiveId: delegation.toUserId, groupId: group.id, scope: group.scope }, trace: { groupId: group.id, scope: group.scope, skipped } };
  }
  return { trace: { groupId: group.id, scope: group.scope, skipped } };
}

function reasonOf(groupsTried: readonly GroupTrace[]): ApproverNotFoundReason {
  const reasons = groupsTried.flatMap((group) => group.skipped.map((skip) => skip.reason));
  if (reasons.includes('CHAIN')) return 'APPROVAL_CYCLE';
  if (reasons.includes('SELF') || reasons.includes('DELEGATE_IS_SELF')) return 'SELF_APPROVAL_ONLY';
  return groupsTried.length > 0 ? 'NO_ACTIVE_APPROVER' : 'NO_GROUP';
}

/**
 * Resolves who approves what `creatorId` created, `level` levels up.
 *  1. The subject's group is the one they are a MEMBER of: the ticket company's first, then the general one.
 *  2. Its first usable approver by position decides; the delegate acts when there is a delegation in force.
 *  3. When a group yields nobody (inactive, the creator themselves, someone already in the chain) the
 *     next group of that chain is tried: self-approval "goes up" from the company group to the general one.
 *  4. Level N repeats the search with the previous level's NOMINAL approver as the subject (a vacation
 *     substitute does not change who sits at the next level). Everyone seen so far is excluded, so a
 *     cycle ends in `APPROVAL_CYCLE` instead of looping, and the work is bounded by the level.
 */
export function resolveApprover(snapshot: ApprovalSnapshot, creatorId: string, level: number): ApproverOutcome {
  const visited = new Set<string>([creatorId]);
  const chain: LevelTrace[] = [];
  let subjectId = creatorId;
  let last: LevelResult | undefined;

  for (let current = 1; current <= level; current += 1) {
    const groupsTried: GroupTrace[] = [];
    let found: LevelResult | undefined;
    for (const group of candidateGroups(snapshot, subjectId)) {
      const picked = pickFromGroup(snapshot, group, creatorId, subjectId, visited);
      groupsTried.push(picked.trace);
      if (picked.result !== undefined) {
        found = picked.result;
        break;
      }
    }
    chain.push({
      level: current,
      subjectId,
      groupsTried,
      resolved: found === undefined ? null : { approverId: found.effectiveId, onBehalfOfId: found.effectiveId === found.nominalId ? null : found.nominalId, groupId: found.groupId, scope: found.scope },
    });
    if (found === undefined) return { found: false, reason: reasonOf(groupsTried), level: current, subjectId, chain };
    visited.add(found.nominalId);
    visited.add(found.effectiveId);
    subjectId = found.nominalId;
    last = found;
  }

  const resolved = chain.at(-1)!.resolved!;
  return { found: true, approverId: resolved.approverId, onBehalfOfId: resolved.onBehalfOfId, level, groupId: last!.groupId, scope: last!.scope, chain };
}

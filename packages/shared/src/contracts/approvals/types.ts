/** How many levels of approval a step may ask for ("the approver of the approver", repeated). */
export const MAX_APPROVAL_LEVEL = 5;

export type ApprovalScope = 'COMPANY' | 'GENERAL';

/** Why a candidate was passed over while resolving an approver. */
export type SkipReason =
  /** The approver is not an active member of the tenant (or the account is disabled). */
  | 'INACTIVE'
  /** The approver is the person who created the ticket. */
  | 'SELF'
  /** The approver already appeared earlier in the chain (an approval cycle). */
  | 'CHAIN'
  /** The approver has a delegation in force and the delegate is not an active member. */
  | 'DELEGATE_INACTIVE'
  /** The approver has a delegation in force and the delegate is the creator. */
  | 'DELEGATE_IS_SELF';

export type ApproverNotFoundReason = 'NO_GROUP' | 'NO_ACTIVE_APPROVER' | 'SELF_APPROVAL_ONLY' | 'APPROVAL_CYCLE';

export interface GroupTrace {
  readonly groupId: string;
  readonly scope: ApprovalScope;
  readonly skipped: ReadonlyArray<{ readonly userId: string; readonly reason: SkipReason }>;
}

export interface LevelTrace {
  readonly level: number;
  /** Whose approver this level looks for: the creator at level 1, the previous level's approver afterwards. */
  readonly subjectId: string;
  readonly groupsTried: readonly GroupTrace[];
  readonly resolved: { readonly approverId: string; readonly onBehalfOfId: string | null; readonly groupId: string; readonly scope: ApprovalScope } | null;
}

export interface ApproverResolution {
  readonly found: true;
  /** Who decides: the delegate when the nominal approver has a delegation in force. */
  readonly approverId: string;
  /** The nominal approver the delegate acts for, or `null` when the approver decides for themselves. */
  readonly onBehalfOfId: string | null;
  readonly level: number;
  readonly groupId: string;
  readonly scope: ApprovalScope;
  readonly chain: readonly LevelTrace[];
}

export interface ApproverNotFound {
  readonly found: false;
  readonly reason: ApproverNotFoundReason;
  readonly level: number;
  readonly subjectId: string;
  readonly chain: readonly LevelTrace[];
}

export type ApproverOutcome = ApproverResolution | ApproverNotFound;

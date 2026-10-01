import type { InitiatorDocument } from '@procesabpm/shared';

export interface Requester {
  readonly userId: string;
  readonly positionId: string | null;
  readonly departmentId: string | null;
  readonly siteId: string | null;
  /** The ticket's company. */
  readonly companyId: string;
  /** Ids of the active groups the requester belongs to. */
  readonly groupIds: ReadonlySet<string>;
  /** The requester's site and all its ancestors. */
  readonly siteAncestry: ReadonlySet<string>;
}

const matches = (initiator: InitiatorDocument, requester: Requester): boolean => {
  switch (initiator.participantType) {
    case 'USER':
      return initiator.userId === requester.userId;
    case 'POSITION':
      return initiator.positionId !== null && initiator.positionId === requester.positionId;
    case 'GROUP':
      return initiator.groupId !== null && requester.groupIds.has(initiator.groupId);
    case 'DEPARTMENT':
      return initiator.departmentId !== null && initiator.departmentId === requester.departmentId;
    case 'COMPANY':
      return initiator.companyId === requester.companyId;
    case 'SITE':
      return initiator.siteId !== null && requester.siteAncestry.has(initiator.siteId);
  }
};

/** Who may start a workflow: a START block without initiators is open to everyone, otherwise any one match is enough. */
export const isAllowedInitiator = (initiators: readonly InitiatorDocument[], requester: Requester): boolean =>
  initiators.length === 0 || initiators.some((initiator) => matches(initiator, requester));

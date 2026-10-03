import type { Principal } from '../../../common/auth/principal.js';

/**
 * Whether two verifications of a socket grant the same ability: everything the CASL ability depends on. When something
 * differs the socket is closed (`PERMISSIONS_CHANGED`) and the client reconnects, so nothing is recomputed in place.
 */
export function sameAuthorization(before: Principal, after: Principal): boolean {
  return (
    before.userId === after.userId &&
    before.tenantId === after.tenantId &&
    before.roleId === after.roleId &&
    before.roleActive === after.roleActive &&
    before.roleIsAdmin === after.roleIsAdmin &&
    before.isOwner === after.isOwner &&
    before.permissionsVersion === after.permissionsVersion &&
    before.membership.departmentId === after.membership.departmentId &&
    before.membership.siteId === after.membership.siteId &&
    before.membership.positionId === after.membership.positionId
  );
}

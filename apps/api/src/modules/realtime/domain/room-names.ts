/**
 * Names of the Socket.IO rooms of this instance. Everything a tenant owns is prefixed by its id, so a room of one tenant
 * can never be confused with another's. Rooms only find local sockets: they never authorize anything.
 */
export const RoomNames = {
  tenant: (tenantId: string) => `t:${tenantId}`,
  member: (tenantId: string, userId: string) => `t:${tenantId}:u:${userId}`,
  role: (tenantId: string, roleId: string) => `t:${tenantId}:r:${roleId}`,
  ticket: (tenantId: string, ticketId: string) => `t:${tenantId}:ticket:${ticketId}`,
  /** Every socket of a person, in any tenant (a change of the account itself). */
  user: (userId: string) => `u:${userId}`,
  session: (sessionId: string) => `s:${sessionId}`,
} as const;

/** The rooms a socket joins when it connects (tickets are joined on subscription). */
export function connectionRooms(identity: { readonly tenantId: string; readonly userId: string; readonly sessionId: string; readonly roleId: string }): string[] {
  return [
    RoomNames.tenant(identity.tenantId),
    RoomNames.member(identity.tenantId, identity.userId),
    RoomNames.role(identity.tenantId, identity.roleId),
    RoomNames.user(identity.userId),
    RoomNames.session(identity.sessionId),
  ];
}
